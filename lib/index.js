/**
 * dsh-boot-animation - host half.
 *
 * Plain JavaScript with no DSH SDK imports, so it needs no compiler and no DSH
 * source checkout: `scripts/build.sh` copies this file to lib/index.js.
 *
 * It serves the intro video and nothing else. Two details matter:
 *
 * 1. Range requests. Browsers issue them for media, and a video element that
 *    gets a 200 where it expected 206 sometimes refuses to play at all.
 *
 * 2. Three-level asset lookup, resolved PER REQUEST so a user can drop in their
 *    own file without restarting DSH:
 *      $DSH_BOOT_ANIMATION                       explicit path
 *      $DSH_HOME/boot-animation/intro.mp4        documented drop-in location
 *      <package>/assets/boot.mp4                 bundled default
 */
import { createReadStream, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-boot-animation'

/** The webserver routes are the only host service this plugin needs. */
export const inject = ['webServer']

const HERE = dirname(fileURLToPath(import.meta.url))
/** lib/index.js -> package root -> assets/boot.mp4 */
const BUNDLED = join(HERE, '..', 'assets', 'boot.mp4')
const ROUTE = '/dsh-boot-animation/boot.mp4'
const STATUS_ROUTE = '/dsh-boot-animation/status.json'
const CONTENT_TYPE = 'video/mp4'

/** Candidate sources, most specific first. */
function candidates() {
  const list = []
  const fromEnv = process.env.DSH_BOOT_ANIMATION
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') {
    list.push({ kind: 'env', path: fromEnv.trim() })
  }
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  list.push({ kind: 'dsh-home', path: join(home, 'boot-animation', 'intro.mp4') })
  list.push({ kind: 'bundled', path: BUNDLED })
  return list
}

/** First existing, non-empty candidate; resolved on every request. */
function resolveVideo() {
  for (const candidate of candidates()) {
    try {
      const stats = statSync(candidate.path)
      if (stats.isFile() && stats.size > 0) return { ...candidate, size: stats.size }
    } catch {
      /* missing or unreadable: try the next one */
    }
  }
  return null
}

function sendJson(res, payload) {
  const body = JSON.stringify(payload, null, 2)
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(body)
}

function serveStatus(res) {
  // Deliberately reports WHICH slot is active without echoing absolute paths
  // back to anything that can reach this port.
  const active = resolveVideo()
  sendJson(res, {
    active: active === null ? null : { kind: active.kind, bytes: active.size },
    candidates: candidates().map((candidate) => {
      let exists = false
      let bytes = 0
      try {
        const stats = statSync(candidate.path)
        exists = stats.isFile() && stats.size > 0
        bytes = stats.size
      } catch {
        exists = false
      }
      return { kind: candidate.kind, exists, bytes }
    }),
    lookupOrder: 'DSH_BOOT_ANIMATION -> $DSH_HOME/boot-animation/intro.mp4 -> bundled assets/boot.mp4',
  })
}

function serveVideo(req, res) {
  const active = resolveVideo()
  if (active === null) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('dsh-boot-animation: no video found (set DSH_BOOT_ANIMATION or add $DSH_HOME/boot-animation/intro.mp4)')
    return
  }

  const size = active.size
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
        res.writeHead(416, { 'content-range': 'bytes */' + String(size) })
        res.end()
        return
      }
      end = Math.min(end, size - 1)
      res.writeHead(206, {
        'content-type': CONTENT_TYPE,
        'content-length': String(end - start + 1),
        'content-range': 'bytes ' + String(start) + '-' + String(end) + '/' + String(size),
        'accept-ranges': 'bytes',
        'cache-control': 'no-store',
      })
      if (req.method === 'HEAD') {
        res.end()
        return
      }
      createReadStream(active.path, { start, end }).pipe(res)
      return
    }
  }

  res.writeHead(200, {
    'content-type': CONTENT_TYPE,
    'content-length': String(size),
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
  })
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  createReadStream(active.path).pipe(res)
}

export function apply(ctx) {
  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: ROUTE, handler: serveVideo }),
    'dsh-boot-animation: boot video',
  )
  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: STATUS_ROUTE, handler: (_req, res) => serveStatus(res) }),
    'dsh-boot-animation: status',
  )
}
