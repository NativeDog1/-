/**
 * dsh-boot-animation - host half.
 *
 * Plain JavaScript with no DSH SDK imports, so it needs no compiler and no DSH
 * source checkout: `scripts/build.sh` copies this file to lib/index.js.
 *
 * It serves the intro video and nothing else. Four details matter:
 *
 * 1. Range requests. Browsers issue them for media, and a video element that
 *    gets a 200 where it expected 206 sometimes refuses to play at all.
 *
 * 2. A LIBRARY, not a single slot. The plugin used to pick one asset off a
 *    three-level list, so adding a second video meant overwriting the first.
 *    Now every clip in every source is listed, the user picks one in the UI, and
 *    the choice is remembered. The old three-level priority is kept as the
 *    fallback when nothing has been picked, so an existing drop-in
 *    (`$DSH_HOME/boot-animation/intro.mp4`) keeps working untouched.
 *
 * 3. The two clips the plugin ships are EMBEDDED IN CODE, not files. There is no
 *    `assets/boot.mp4` or `videos/*.mp4` to lose, be filtered out of the package,
 *    or be shipped with the wrong container flags. `lib/clips.meta.js` carries
 *    the names and sizes; `lib/clips.data.js` carries the base64 bytes and is
 *    imported LAZILY, so the host does not parse ~8MB it may never need.
 *    A user's own files still work exactly as before and still win.
 *
 * 4. Everything is resolved PER REQUEST, so a user can drop in their own file
 *    without restarting DSH.
 *
 * Layout:
 *   $DSH_HOME/boot-animation/selection.json   which id plays (written by us)
 *   $DSH_HOME/boot-animation/videos/*.mp4     user library (drop-in)
 *   $DSH_HOME/boot-animation/intro.mp4        legacy drop-in, still honoured
 *   lib/clips.meta.js + lib/clips.data.js     the embedded built-in clips
 */
import { createHash } from 'node:crypto'
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
import { CLIPS } from './clips.meta.js'

export const name = 'dsh-boot-animation'

/** The webserver routes are the only host service this plugin needs. */
export const inject = ['webServer']

const HERE = dirname(fileURLToPath(import.meta.url))
/** lib/index.js -> package root */
const PKG_ROOT = join(HERE, '..')

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

/**
 * Which copy survives when the same clip exists in more than one place.
 * Lower wins, so the plugin's own copy beats a user's duplicate.
 */
const SOURCE_RANK = { embedded: 0, yours: 2, env: 3 }

/** Display order in the picker: the plugin's clips first, the user's after. */
const LIST_RANK = { embedded: 0, yours: 2, env: 3 }

/** Ids of the embedded clips are namespaced so they can never collide with a path. */
const EMBEDDED_PREFIX = 'builtin:'

/**
 * Decoded embedded clips, filled on first use.
 *
 * `clips.data.js` is ~8MB of base64. Importing it eagerly would make every DSH
 * start pay for a video it may never serve, so it is imported on the first
 * request for an embedded clip and the decoded Buffers are kept afterwards.
 */
const decoded = new Map()
let dataModule = null

async function embeddedBuffer(id) {
  const cached = decoded.get(id)
  if (cached !== undefined) return cached
  if (dataModule === null) dataModule = await import('./clips.data.js')
  for (const clip of CLIPS) {
    if (decoded.has(clip.id)) continue
    const b64 = dataModule[clip.id]
    if (typeof b64 === 'string') decoded.set(clip.id, Buffer.from(b64, 'base64'))
  }
  return decoded.get(id) ?? null
}

const HOME = () => process.env.DSH_HOME ?? join(homedir(), '.dsh')
const HOME_DIR = () => join(HOME(), 'boot-animation')
const SELECTION_FILE = () => join(HOME_DIR(), 'selection.json')

/**
 * Display names are only needed for files the plugin itself ships, and it no
 * longer ships any: both built-in clips are embedded and carry their names in
 * `clips.meta.js`. A file the user dropped in keeps its own name, because the
 * plugin cannot know what it contains.
 */
function displayName(_source, fileName) {
  return basename(fileName, extname(fileName))
}

/**
 * Managed directories: what the USER adds. The plugin's own clips are embedded
 * in code now, so there is no package directory to scan — nothing can be lost to
 * a missing `files` entry or a stale copy in an install.
 */
function scanDirs() {
  return [
    { source: 'yours', dir: join(HOME_DIR(), 'videos'), writable: true },
    { source: 'yours', dir: HOME_DIR(), writable: true },
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

/**
 * Content identity of a file, cached against (size, mtime).
 *
 * Needed so a user's copy of a built-in clip collapses into the built-in row.
 * Embedding made this exact rather than heuristic: the embedded clips carry
 * their real sha256, and size+mtime alone would miss a copy that was re-saved.
 * Hashing a few megabytes costs milliseconds and happens once per distinct file
 * per process, because the result is memoised on the stat that produced it.
 */
const contentKeys = new Map()

function contentKeyOf(filePath, stats) {
  const stamp = `${stats.size}@${Math.round(stats.mtimeMs)}`
  const cached = contentKeys.get(filePath)
  if (cached !== undefined && cached.stamp === stamp) return cached.key
  let key = `size:${stats.size}`
  try {
    key = createHash('sha256').update(readFileSync(filePath)).digest('hex').slice(0, 16)
  } catch {
    /* unreadable: fall back to a size-only key, which at worst merges equals */
  }
  contentKeys.set(filePath, { stamp, key })
  return key
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
 * Every distinct clip the plugin can play: the embedded built-ins plus whatever
 * the user has dropped in.
 *
 * Two de-duplications happen here, and both exist because the picker was showing
 * more rows than there were videos:
 *
 * 1. By real path, so `intro.mp4` is not listed twice (its directory is also a
 *    scan root).
 * 2. By CONTENT, so one clip is one row no matter how many copies of it exist.
 *    This is the case that actually confused a user: a copy of a built-in clip
 *    sat beside the built-in itself, under a different badge, and it read as
 *    "these are not the same kind of thing".
 *
 *    Identity is a content hash, not size+mtime. Embedded clips carry their
 *    sha256 in the metadata, and a file's hash is computed once and cached
 *    against (size, mtime) — so an exact duplicate is recognised even when its
 *    mtime differs, which size+mtime could not do. The cost is bounded: a hash
 *    per distinct file, once per process.
 *
 *    When copies collide the EMBEDDED entry wins: it cannot be deleted or lost,
 *    so a selection pointing at it always resolves. The user's file stays where
 *    it is — collapsed in the LIST, never on disk.
 */
function listVideos() {
  const seen = new Set()
  const found = []

  for (const clip of CLIPS) {
    found.push({
      id: EMBEDDED_PREFIX + clip.id,
      name: clip.name,
      file: null,
      ext: clip.ext,
      source: 'embedded',
      writable: false,
      bytes: clip.bytes,
      mtimeMs: 0,
      mtime: null,
      legacy: false,
      // Guaranteed at embed time: scripts/embed-clips.mjs refuses a clip whose
      // moov is not already in front.
      faststart: true,
      path: null,
      embedded: clip.id,
      contentKey: clip.sha256,
      copies: 1,
      alsoAt: [],
    })
  }

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
      found.push({
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
        embedded: null,
        contentKey: contentKeyOf(full, stats),
        copies: 1,
        alsoAt: [],
      })
    }
  }

  const byContent = new Map()
  for (const video of found) {
    const kept = byContent.get(video.contentKey)
    if (kept === undefined) {
      byContent.set(video.contentKey, video)
      continue
    }
    const keepNew = (SOURCE_RANK[video.source] ?? 9) < (SOURCE_RANK[kept.source] ?? 9)
    const winner = keepNew ? video : kept
    const loser = keepNew ? kept : video
    winner.copies += loser.copies
    winner.alsoAt.push(loser.source, ...loser.alsoAt)
    byContent.set(video.contentKey, winner)
  }

  const out = [...byContent.values()]
  out.sort((a, b) => {
    const bySource = (LIST_RANK[a.source] ?? 9) - (LIST_RANK[b.source] ?? 9)
    if (bySource !== 0) return bySource
    // Keep the embedded clips in the order they were embedded.
    if (a.source === 'embedded' && b.source === 'embedded') {
      return CLIPS.findIndex((c) => EMBEDDED_PREFIX + c.id === a.id) -
        CLIPS.findIndex((c) => EMBEDDED_PREFIX + c.id === b.id)
    }
    return b.mtimeMs - a.mtimeMs
  })
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
          faststart: hasFaststart(fromEnv.trim()),
          path: fromEnv.trim(),
          embedded: null,
          contentKey: contentKeyOf(fromEnv.trim(), stats),
          copies: 1,
          alsoAt: [],
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

  // Nothing of the user's: the plugin's own clips. These are embedded, so this
  // can never come up empty — which is the point of embedding them.
  const embedded = videos.find((v) => v.source === 'embedded')
  if (embedded) return { video: embedded, how: 'embedded', videos }

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
    embedded: v.embedded ?? null,
    bytes: v.bytes,
    mtime: v.mtime,
    legacy: v.legacy,
    faststart: v.faststart === true,
    // How many on-disk copies collapsed into this row, and where the others
    // live. Reported so a collapsed duplicate is visible rather than mysterious.
    copies: v.copies ?? 1,
    alsoAt: v.alsoAt ?? [],
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
      {
        kind: 'embedded',
        exists: CLIPS.length > 0,
        bytes: CLIPS.reduce((total, clip) => total + clip.bytes, 0),
      },
    ],
    lookupOrder:
      'selection.json -> DSH_BOOT_ANIMATION -> $DSH_HOME/boot-animation/intro.mp4 -> ' +
      '$DSH_HOME/boot-animation/videos -> embedded built-ins',
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
 * Serve media bytes with Range support and REVALIDATING caching.
 *
 * `no-store` used to be here, which is the worst of both worlds for media: the
 * browser may not keep a single byte, so every overlay opening re-downloaded the
 * whole clip, and the splash sat black while it did. `no-cache` means "keep it,
 * but ask before using" — combined with the ETag, an unchanged clip answers 304
 * and playback starts from the local copy, while a clip the user just swapped in
 * fails the comparison and streams fresh. Correct AND fast.
 *
 * `open(start, end)` yields the body for the resolved slice, either a Buffer
 * (embedded clips) or a Readable (files), so this one routine covers both.
 */
function sendMedia(req, res, { size, etag, lastModified, open }) {
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

  const body = (start, end) => {
    const chunk = open(start, end)
    if (Buffer.isBuffer(chunk)) res.end(chunk)
    else chunk.pipe(res)
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
      body(start, end)
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
  body(undefined, undefined)
}

/** Serve a clip from disk. */
function streamFile(req, res, filePath, size) {
  let stats = null
  try {
    stats = statSync(filePath)
  } catch {
    /* fall through: serve without validators */
  }
  sendMedia(req, res, {
    size,
    etag: stats === null ? null : etagOf(stats),
    lastModified: stats === null ? null : new Date(stats.mtimeMs).toUTCString(),
    open: (start, end) =>
      start === undefined ? createReadStream(filePath) : createReadStream(filePath, { start, end }),
  })
}

/** Serve an embedded clip from memory. */
function streamEmbedded(req, res, buffer, contentKey) {
  sendMedia(req, res, {
    size: buffer.length,
    // The content hash is already the clip's identity, so revalidation is exact
    // rather than stat-based.
    etag: '"embedded-' + contentKey + '"',
    lastModified: null,
    open: (start, end) => (start === undefined ? buffer : buffer.subarray(start, end + 1)),
  })
}

/**
 * Serve one resolved clip, from memory or from disk.
 *
 * Async because an embedded clip's data module is imported on first use, so the
 * host does not parse ~8MB of base64 at startup for a video it may never serve.
 */
async function streamClip(req, res, video) {
  if (video.embedded !== null && video.embedded !== undefined) {
    const buffer = await embeddedBuffer(video.embedded)
    if (buffer === null) {
      sendText(res, 500, 'dsh-boot-animation: embedded clip data is missing from lib/clips.data.js')
      return
    }
    streamEmbedded(req, res, buffer, video.contentKey)
    return
  }
  streamFile(req, res, video.path, video.bytes)
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
  void streamClip(req, res, video).catch(() => {
    try {
      sendText(res, 500, 'dsh-boot-animation: could not read the clip')
    } catch {
      /* headers already sent */
    }
  })
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
  void streamClip(req, res, video).catch(() => {
    try {
      sendText(res, 500, 'dsh-boot-animation: could not read the clip')
    } catch {
      /* headers already sent */
    }
  })
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
