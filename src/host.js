/**
 * dsh-boot-animation - host half.
 *
 * Plain JavaScript with no DSH SDK imports, so it needs no compiler and no DSH
 * source checkout: `scripts/build.sh` copies this file to lib/index.js.
 *
 * It serves the intro video and nothing else. Three details matter:
 *
 * 1. Range requests. Browsers issue them for media, and a video element that
 *    gets a 200 where it expected 206 sometimes refuses to play at all.
 *
 * 2. A LIBRARY, not a single slot. The plugin used to pick one asset off a
 *    three-level list, so adding a second video meant overwriting the first.
 *    Now every .mp4 in every managed directory is listed, the user picks one in
 *    the UI, and the choice is remembered. The old three-level priority is kept
 *    as the fallback when nothing has been picked, so an existing drop-in
 *    (`$DSH_HOME/boot-animation/intro.mp4`) keeps working untouched.
 *
 * 3. Everything is resolved PER REQUEST, so a user can drop in their own file
 *    without restarting DSH.
 *
 * Layout:
 *   $DSH_HOME/boot-animation/selection.json   which id plays (written by us)
 *   $DSH_HOME/boot-animation/videos/*.mp4     user library (drop-in)
 *   $DSH_HOME/boot-animation/intro.mp4        legacy drop-in, still honoured
 *   <package>/videos/*.mp4                    shipped library
 *   <package>/assets/boot.mp4                 bundled default / legacy fallback
 */
import {
  createReadStream,
  mkdirSync,
  openSync,
  readSync,
  closeSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-boot-animation'

/** The webserver routes are the only host service this plugin needs. */
export const inject = ['webServer']

const HERE = dirname(fileURLToPath(import.meta.url))
/** lib/index.js -> package root */
const PKG_ROOT = join(HERE, '..')
const BUNDLED = join(PKG_ROOT, 'assets', 'boot.mp4')
const PKG_VIDEOS = join(PKG_ROOT, 'videos')

const BASE_ROUTE = '/dsh-boot-animation'
const ROUTE = BASE_ROUTE + '/boot.mp4'
/**
 * NO trailing slash. The webserver matches a prefix route with
 *   pathname !== prefix && !pathname.startsWith(prefix + '/')
 * so a registered path of `.../media/` would be tested as
 * `.../media//` and never match a real `.../media/<id>` request — every
 * media URL 404s. Keep this bare and add the separator at slice time.
 */
const MEDIA_ROUTE = BASE_ROUTE + '/media'
const LIST_ROUTE = BASE_ROUTE + '/videos.json'
const SELECT_ROUTE = BASE_ROUTE + '/select'
const STATUS_ROUTE = BASE_ROUTE + '/status.json'
const CONTENT_TYPE = 'video/mp4'

/** Extensions treated as video for listing purposes. */
const VIDEO_EXT = new Set(['.mp4', '.m4v', '.webm', '.mov', '.mkv'])

const HOME = () => process.env.DSH_HOME ?? join(homedir(), '.dsh')
const HOME_DIR = () => join(HOME(), 'boot-animation')
const SELECTION_FILE = () => join(HOME_DIR(), 'selection.json')

/**
 * Friendly label for the plugin's own fallback asset.
 *
 * `assets/boot.mp4` is the historical filename and stays that way so existing
 * installs and build.sh keep working — but "boot" tells a user nothing about
 * which clip it is. The picker ended up showing two opaque rows, and the same
 * video looked absent from the plugin entirely. Files the plugin SHIPS carry
 * descriptive names instead (videos/*.mp4), so only this one needs a label.
 */
const BUNDLED_LABEL = { 'boot.mp4': '内置默认片头' }

function displayName(source, fileName) {
  if (source === 'bundled') {
    const label = BUNDLED_LABEL[fileName.toLowerCase()]
    if (label !== undefined) return label
  }
  return basename(fileName, extname(fileName))
}

/**
 * Managed directories, most specific first. `source` is what the UI shows.
 * `bundled` is last so a user file always wins a tie by id order.
 */
function scanDirs() {
  return [
    { source: 'yours', dir: join(HOME_DIR(), 'videos'), writable: true },
    { source: 'yours', dir: HOME_DIR(), writable: true },
    { source: 'shipped', dir: PKG_VIDEOS, writable: false },
    { source: 'bundled', dir: join(PKG_ROOT, 'assets'), writable: false },
  ]
}

function statFile(p) {
  try {
    const s = statSync(p)
    return s.isFile() && s.size > 0 ? s : null
  } catch {
    return null
  }
}

/**
 * Whether the `moov` atom sits in the head of the file.
 *
 * This is the difference between a video that starts playing immediately and
 * one that shows nothing until the whole file has been downloaded — and the
 * client closes the overlay after 25s (STALL_TIMEOUT_MS), so an un-optimised
 * mp4 reads to a user as "the video will not load". Cheap to test: read the
 * first 64KB and look for `moov`. An optimised file puts it within the first
 * few hundred bytes; an un-optimised one has only `ftyp`/`mdat` up there.
 *
 * Reported, never enforced: a `.webm` or an exotic container has no `moov` at
 * all and is not something to warn about, so `false` here means "not known to
 * be optimised", and the UI only nudges on `.mp4`/`.m4v`.
 */
function hasFaststart(filePath) {
  const HEAD = 65536
  let fd = null
  try {
    fd = openSync(filePath, 'r')
    const buffer = Buffer.alloc(HEAD)
    const read = readSync(fd, buffer, 0, HEAD, 0)
    const head = buffer.subarray(0, read).toString('latin1')
    const moov = head.indexOf('moov')
    if (moov === -1) return false
    const mdat = head.indexOf('mdat')
    return mdat === -1 || moov < mdat
  } catch {
    return false
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd)
      } catch {
        /* already closed */
      }
    }
  }
}

/** Stable, URL-safe id for a path. Deterministic across processes (no hash lib). */
function makeId(p) {
  let h = 0x811c9dc5
  const normalised = p.replace(/\\/g, '/').toLowerCase()
  for (let i = 0; i < normalised.length; i += 1) {
    h ^= normalised.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  const stem = basename(p, extname(p))
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return (stem || 'video') + '-' + h.toString(16).padStart(8, '0')
}

function readSelection() {
  try {
    const raw = readFileSyncSafe(SELECTION_FILE())
    if (raw === null) return null
    const parsed = JSON.parse(raw)
    return typeof parsed?.id === 'string' && parsed.id !== '' ? parsed.id : null
  } catch {
    return null
  }
}

function readFileSyncSafe(p) {
  try {
    return readFileSync(p, 'utf8')
  } catch {
    return null
  }
}

function writeSelection(id) {
  const dir = HOME_DIR()
  mkdirSync(dir, { recursive: true })
  const payload = JSON.stringify({ id, at: new Date().toISOString() }, null, 2)
  const target = SELECTION_FILE()
  const tmp = target + '.tmp'
  writeFileSync(tmp, payload, 'utf8')
  // Atomic-ish: a half-written selection.json would silently reset the pick.
  try {
    renameSync(tmp, target)
  } catch {
    writeFileSync(target, payload, 'utf8')
  }
}

/**
 * Every video currently on disk, de-duplicated by real path so `intro.mp4`
 * does not appear twice (its directory is also a scan root).
 */
function listVideos() {
  const seen = new Set()
  const out = []
  for (const { source, dir, writable } of scanDirs()) {
    let names = []
    try {
      names = readdirSync(dir)
    } catch {
      continue
    }
    for (const fileName of names) {
      const ext = extname(fileName).toLowerCase()
      if (!VIDEO_EXT.has(ext)) continue
      const full = join(dir, fileName)
      const key = full.replace(/\\/g, '/').toLowerCase()
      if (seen.has(key)) continue
      const stats = statFile(full)
      if (stats === null) continue
      seen.add(key)
      out.push({
        id: makeId(full),
        name: displayName(source, fileName),
        file: fileName,
        ext,
        source,
        writable,
        bytes: stats.size,
        mtimeMs: stats.mtimeMs,
        mtime: new Date(stats.mtimeMs).toISOString(),
        legacy: fileName.toLowerCase() === 'intro.mp4',
        faststart: hasFaststart(full),
        path: full,
      })
    }
  }
  // Newest first inside each source, but keep source precedence stable.
  const rank = { yours: 0, shipped: 1, bundled: 2 }
  out.sort((a, b) => (rank[a.source] ?? 9) - (rank[b.source] ?? 9) || b.mtimeMs - a.mtimeMs)
  return out
}

/**
 * Which video plays. An explicit pick wins; otherwise the historical
 * three-level priority, so nothing that worked before stops working.
 */
function resolveActive() {
  const videos = listVideos()
  const picked = readSelection()
  if (picked !== null) {
    const hit = videos.find((v) => v.id === picked)
    if (hit) return { video: hit, how: 'selected', videos }
    // Picked file was deleted: fall through rather than show nothing.
  }

  const fromEnv = process.env.DSH_BOOT_ANIMATION
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') {
    const candidates = listVideos().find((v) => v.path === fromEnv.trim())
    if (candidates) return { video: candidates, how: 'env', videos }
    const stats = statFile(fromEnv.trim())
    if (stats !== null) {
      return {
        video: {
          id: makeId(fromEnv.trim()),
          name: basename(fromEnv.trim(), extname(fromEnv.trim())),
          file: basename(fromEnv.trim()),
          ext: extname(fromEnv.trim()).toLowerCase(),
          source: 'env',
          writable: false,
          bytes: stats.size,
          mtimeMs: stats.mtimeMs,
          mtime: new Date(stats.mtimeMs).toISOString(),
          legacy: false,
          path: fromEnv.trim(),
        },
        how: 'env',
        videos,
      }
    }
  }

  const legacyDropIn = videos.find((v) => v.source === 'yours' && v.legacy)
  if (legacyDropIn) return { video: legacyDropIn, how: 'legacy-dropin', videos }

  const yours = videos.find((v) => v.source === 'yours')
  if (yours) return { video: yours, how: 'library', videos }

  const shipped = videos.find((v) => v.source === 'shipped')
  if (shipped) return { video: shipped, how: 'library', videos }

  const bundled = videos.find((v) => v.source === 'bundled')
  if (bundled) return { video: bundled, how: 'bundled', videos }

  // Nothing in the managed dirs: still honour a literal bundled path, because
  // the package ships assets/boot.mp4 even if it were filtered out above.
  const stats = statFile(BUNDLED)
  if (stats !== null) {
    return {
      video: {
        id: makeId(BUNDLED),
        name: 'boot',
        file: 'boot.mp4',
        ext: '.mp4',
        source: 'bundled',
        writable: false,
        bytes: stats.size,
        mtimeMs: stats.mtimeMs,
        mtime: new Date(stats.mtimeMs).toISOString(),
        legacy: false,
        path: BUNDLED,
      },
      how: 'bundled',
      videos,
    }
  }
  return { video: null, how: 'none', videos }
}

function findById(id) {
  if (id === 'active') {
    const active = resolveActive()
    return active.video
  }
  return listVideos().find((v) => v.id === id) ?? null
}

function sendJson(res, payload, status = 200) {
  const body = JSON.stringify(payload, null, 2)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(body)
}

/**
 * Plain-text reply, always uncacheable.
 *
 * Every failure path has to say `no-store`. A 404 with no cache directive is
 * heuristically cacheable, so a route that 404s once while it is broken keeps
 * 404ing in that browser AFTER the fix — the server returns 200 and the user
 * still sees nothing. That is exactly how "the video will not play" survived a
 * fix that curl proved was live.
 */
function sendText(res, status, body) {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(body)
}

function publicVideo(v, extra = {}) {
  return {
    id: v.id,
    name: v.name,
    file: v.file,
    ext: v.ext,
    source: v.source,
    writable: v.writable,
    bytes: v.bytes,
    mtime: v.mtime,
    legacy: v.legacy,
    faststart: v.faststart === true,
    ...extra,
  }
}

function serveList(res) {
  const { video, how, videos } = resolveActive()
  sendJson(res, {
    activeId: video === null ? null : video.id,
    activeHow: how,
    videos: videos.map((v) => publicVideo(v, { active: video !== null && v.id === video.id })),
    userDir: join(HOME_DIR(), 'videos'),
    accepts: [...VIDEO_EXT],
  })
}

function serveStatus(res) {
  // Deliberately reports WHICH slot is active without echoing absolute paths
  // back to anything that can reach this port.
  const { video, how, videos } = resolveActive()
  sendJson(res, {
    active: video === null ? null : { kind: how, id: video.id, name: video.name, bytes: video.bytes },
    count: videos.length,
    videos: videos.map((v) => publicVideo(v, { active: video !== null && v.id === video.id })),
    // Legacy fields, kept because README and older probes read them.
    candidates: [
      { kind: 'selection', exists: readSelection() !== null, bytes: 0 },
      { kind: 'library', exists: videos.length > 0, bytes: videos.length },
      { kind: 'bundled', exists: statFile(BUNDLED) !== null, bytes: statFile(BUNDLED)?.size ?? 0 },
    ],
    lookupOrder: 'selection.json -> DSH_BOOT_ANIMATION -> $DSH_HOME/boot-animation/intro.mp4 -> $DSH_HOME/boot-animation/videos -> shipped/bundled',
  })
}

/**
 * Identity of one on-disk cut, for conditional requests.
 *
 * Size plus mtime is enough: a file the user replaces differs in at least one of
 * them, and both are free (no read, no hash of a 3MB file per request).
 */
function etagOf(stats) {
  return '"' + stats.size.toString(16) + '-' + Math.round(stats.mtimeMs).toString(16) + '"'
}

/**
 * Stream a file with Range support, and with REVALIDATING caching.
 *
 * `no-store` used to be here, which is the worst of both worlds for media: the
 * browser may not keep a single byte, so every overlay opening re-downloaded the
 * whole clip, and the splash sat black while it did. `no-cache` means "keep it,
 * but ask before using" — combined with the ETag, an unchanged clip answers 304
 * and playback starts from the local copy, while a clip the user just swapped in
 * fails the comparison and streams fresh. Correct AND fast.
 */
function streamFile(req, res, filePath, size) {
  let stats = null
  try {
    stats = statSync(filePath)
  } catch {
    /* fall through: serve without validators */
  }
  const etag = stats === null ? null : etagOf(stats)
  const lastModified = stats === null ? null : new Date(stats.mtimeMs).toUTCString()
  const validators = {}
  if (etag !== null) validators.etag = etag
  if (lastModified !== null) validators['last-modified'] = lastModified

  if (etag !== null) {
    const inm = req.headers['if-none-match']
    const matched =
      typeof inm === 'string' &&
      inm
        .split(',')
        .map((s) => s.trim())
        .some((candidate) => candidate === etag || candidate === '*')
    if (matched) {
      // The body the browser already has is still current.
      res.writeHead(304, { ...validators, 'cache-control': 'no-cache' })
      res.end()
      return
    }
  }

  const range = req.headers.range
  if (typeof range === 'string') {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
    if (match !== null) {
      const rawStart = match[1]
      const rawEnd = match[2]
      let start = rawStart === '' ? undefined : Number(rawStart)
      let end = rawEnd === '' ? undefined : Number(rawEnd)
      if (start === undefined && end !== undefined) {
        // Suffix form: last N bytes.
        start = Math.max(0, size - end)
        end = size - 1
      }
      if (start !== undefined && end === undefined) end = size - 1
      const valid =
        start !== undefined &&
        end !== undefined &&
        Number.isFinite(start) &&
        Number.isFinite(end) &&
        start <= end &&
        start < size
      if (!valid) {
        res.writeHead(416, {
          'content-range': 'bytes */' + String(size),
          'cache-control': 'no-store',
        })
        res.end()
        return
      }
      end = Math.min(end, size - 1)
      res.writeHead(206, {
        ...validators,
        'content-type': CONTENT_TYPE,
        'content-length': String(end - start + 1),
        'content-range': 'bytes ' + String(start) + '-' + String(end) + '/' + String(size),
        'accept-ranges': 'bytes',
        'cache-control': 'no-cache',
      })
      if (req.method === 'HEAD') {
        res.end()
        return
      }
      createReadStream(filePath, { start, end }).pipe(res)
      return
    }
  }

  res.writeHead(200, {
    ...validators,
    'content-type': CONTENT_TYPE,
    'content-length': String(size),
    'accept-ranges': 'bytes',
    'cache-control': 'no-cache',
  })
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  createReadStream(filePath).pipe(res)
}

/** The historical single-video route: whatever is active right now. */
function serveVideo(req, res) {
  const { video } = resolveActive()
  if (video === null) {
    sendText(
      res,
      404,
      'dsh-boot-animation: no video found (drop an .mp4 into ' +
        join(HOME_DIR(), 'videos') +
        ', set DSH_BOOT_ANIMATION, or add $DSH_HOME/boot-animation/intro.mp4)',
    )
    return
  }
  streamFile(req, res, video.path, video.bytes)
}

/**
 * One specific video from the library, by id.
 *
 * The handler signature is `(req, res)` — the webserver does NOT pass a URL as
 * a third argument. Reading `req.url` is therefore the only way to see the id,
 * and doing it from a parameter that is always undefined made every request
 * 404 (the library listed videos it could not then serve).
 */
function serveMedia(req, res) {
  const raw = typeof req.url === 'string' ? req.url : ''
  const path = raw.split('?')[0]
  // MEDIA_ROUTE has no trailing slash, so drop exactly one separator here.
  const id = decodeURIComponent(path.slice(MEDIA_ROUTE.length + 1))
  const video = id === '' ? null : findById(id)
  if (video === null) {
    sendText(res, 404, 'dsh-boot-animation: no such video id')
    return
  }
  streamFile(req, res, video.path, video.bytes)
}

/** POST /select  { "id": "..." }  — remembers the user's choice. */
function handleSelect(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, { ok: false, error: 'POST required' }, 405)
    return
  }
  let body = ''
  req.on('data', (chunk) => {
    body += chunk
    if (body.length > 8192) req.destroy()
  })
  req.on('end', () => {
    let id = null
    try {
      id = JSON.parse(body)?.id ?? null
    } catch {
      sendJson(res, { ok: false, error: 'invalid JSON body' }, 400)
      return
    }
    if (typeof id !== 'string' || id === '') {
      sendJson(res, { ok: false, error: 'id must be a non-empty string' }, 400)
      return
    }
    const video = listVideos().find((v) => v.id === id) ?? null
    if (video === null) {
      sendJson(res, { ok: false, error: 'no video with that id' }, 404)
      return
    }
    try {
      writeSelection(video.id)
    } catch (error) {
      sendJson(res, { ok: false, error: 'could not save selection: ' + String(error?.message ?? error) }, 500)
      return
    }
    sendJson(res, { ok: true, activeId: video.id, name: video.name })
  })
  req.on('error', () => {
    try {
      sendJson(res, { ok: false, error: 'request error' }, 400)
    } catch {
      /* socket already gone */
    }
  })
}

export function apply(ctx) {
  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: ROUTE, handler: serveVideo }),
    'dsh-boot-animation: boot video',
  )
  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: MEDIA_ROUTE, handler: serveMedia }),
    'dsh-boot-animation: video library',
  )
  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: LIST_ROUTE, handler: (_req, res) => serveList(res) }),
    'dsh-boot-animation: video list',
  )
  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: SELECT_ROUTE, handler: handleSelect }),
    'dsh-boot-animation: select video',
  )
  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: STATUS_ROUTE, handler: (_req, res) => serveStatus(res) }),
    'dsh-boot-animation: status',
  )
}
