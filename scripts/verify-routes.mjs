/**
 * verify-routes.mjs — route regression test for the host half.
 *
 * Why this exists: the host registers webserver routes, and the way the
 * webserver MATCHES them is not obvious. A prefix route is matched with
 *
 *   pathname !== prefix && !pathname.startsWith(`${prefix}/`)
 *
 * so registering `.../media/` (with a trailing slash) makes the matcher test
 * `.../media//`, which no real request ever starts with — every media URL 404s.
 * That shipped once. A hand-rolled probe using its own `startsWith(prefix)`
 * cannot see it, because the probe is not using the server's rule.
 *
 * So this file reproduces the server's exact rule (copied from
 * @deepseek-ai/dsh-host-webserver) and drives the real handlers through it.
 * Any route that only matches under a looser rule the server does not use will
 * fail here.
 *
 * Usage: node scripts/verify-routes.mjs
 */
import { apply } from '../lib/index.js'

const BASE = '/dsh-boot-animation'

// --- capture registrations, mirroring the webserver's two tables ---
const exact = new Map()
const prefixes = new Map()
const ctx = {
  effect: (fn) => fn(),
  webServer: {
    register(route) {
      const table = route.kind === 'exact' ? exact : prefixes
      if (table.has(route.path)) throw new Error(`duplicate ${route.kind} route "${route.path}"`)
      table.set(route.path, route)
      return () => {}
    },
  },
}
apply(ctx)

/**
 * The webserver's own resolution: exact table first, then longest-prefix-wins.
 * Kept character-for-character in spirit with the shipped implementation.
 */
function resolve(pathname) {
  const hit = exact.get(pathname)
  if (hit !== undefined) return hit
  let best
  for (const [prefix, route] of prefixes) {
    if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) continue
    if (best === undefined || prefix.length > best.path.length) best = route
  }
  return best
}

/** Drive one request through the resolved handler. */
function call(rawUrl, method = 'GET', headers = {}) {
  return new Promise((done) => {
    const pathname = rawUrl.split('?')[0]
    const route = resolve(pathname)
    if (route === undefined) {
      done({ code: 404, note: 'NO ROUTE MATCHED' })
      return
    }
    const req = { method, url: rawUrl, headers, on: () => req, destroy: () => {} }
    const res = {
      statusCode: 200,
      headers: {},
      write: () => true,
      on: () => {},
      once: () => {},
      emit: () => {},
      writeHead(code, headers) {
        this.statusCode = code
        Object.assign(this.headers, headers ?? {})
      },
      end(payload) {
        done({
          code: this.statusCode,
          headers: this.headers,
          body: payload === undefined ? null : String(payload),
        })
      },
    }
    route.handler(req, res)
  })
}

const failures = []
const resources = {}
async function expect(url, want) {
  const r = await call(url)
  resources[url] = r
  const ok = r.code === want
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${url} -> ${r.code} (want ${want})${r.note === undefined ? '' : ' ' + r.note}`)
  if (!ok) failures.push(`${url} -> ${r.code} (want ${want})`)
  return r
}

/**
 * A failure must never be cacheable.
 *
 * A 404 with no cache directive is heuristically cacheable, so a route that
 * 404s once while broken keeps 404ing in that browser long after the fix: the
 * server answers 200 to curl and the user still sees nothing. Asserting it here
 * is the only way that stays true as routes are added.
 */
function expectNoStore(url) {
  const r = resources[url]
  if (r === undefined) {
    failures.push(`${url}: never requested, cannot check cacheability`)
    return
  }
  const value = r.headers?.['cache-control'] ?? ''
  const ok = String(value).includes('no-store')
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${url} cache-control: ${value === '' ? '(none)' : value}`)
  if (!ok) failures.push(`${url} answered ${r.code} without cache-control: no-store`)
}

console.log('registered exact   :', [...exact.keys()].join(' ') || '(none)')
console.log('registered prefixes:', [...prefixes.keys()].join(' '))

// A route registered as a prefix with a trailing slash can never match: this is
// the exact shape of the bug this file exists to catch.
for (const path of prefixes.keys()) {
  if (path.endsWith('/')) {
    failures.push(`prefix route "${path}" ends with "/" — the server matches "${path}/" and it will never fire`)
  }
}

const list = JSON.parse((await expect(`${BASE}/videos.json`, 200)).body ?? '{"videos":[]}')
const ids = Array.isArray(list.videos) ? list.videos.map((v) => v.id) : []
console.log(`library: ${ids.length} video(s) — ${ids.join(', ')}`)

await expect(`${BASE}/status.json`, 200)
await expect(`${BASE}/boot.mp4`, 200)
for (const id of ids) await expect(`${BASE}/media/${id}`, 200)
const missId = `${BASE}/media/definitely-not-an-id`
const noId = `${BASE}/media`
const slashId = `${BASE}/media/`
const wrongMethod = `${BASE}/select`
await expect(missId, 404)
await expect(noId, 404)
await expect(slashId, 404)
await expect(wrongMethod, 405) // GET on a POST-only endpoint
await expect(`${BASE}/nope.json`, 404)

console.log('\nuncacheable failures:')
for (const url of [missId, noId, slashId, wrongMethod]) expectNoStore(url)

/**
 * Media must be REUSABLE, not uncacheable.
 *
 * `no-store` on the video meant the browser could keep nothing, so every
 * overlay opening re-downloaded the whole clip and the splash sat black while
 * it did. The clip needs `no-cache` plus an ETag: a 304 reuses the local copy
 * (fast), and a swapped-in clip fails the comparison and streams fresh (correct).
 */
console.log('\nreusable media:')
{
  const url = `${BASE}/boot.mp4`
  const first = await call(url)
  const etag = first.headers?.etag
  const cache = String(first.headers?.['cache-control'] ?? '')
  const okEtag = typeof etag === 'string' && etag.length > 2
  const okCache = cache.includes('no-cache') && !cache.includes('no-store')
  console.log(`  ${okEtag ? 'ok  ' : 'FAIL'} ${url} etag: ${etag ?? '(none)'}`)
  console.log(`  ${okCache ? 'ok  ' : 'FAIL'} ${url} cache-control: ${cache === '' ? '(none)' : cache}`)
  if (!okEtag) failures.push(`${url} has no ETag, so nothing can be reused`)
  if (!okCache) failures.push(`${url} cache-control is "${cache}" — it must allow revalidated reuse`)

  if (okEtag) {
    const second = await call(url, 'GET', { 'if-none-match': etag })
    const ok304 = second.code === 304
    console.log(`  ${ok304 ? 'ok  ' : 'FAIL'} ${url} with If-None-Match -> ${second.code} (want 304)`)
    if (!ok304) failures.push(`${url} ignored If-None-Match (got ${second.code}, want 304) — replay would refetch`)
  }
}

/**
 * A cached clip must never be served for a DIFFERENT clip.
 *
 * This is the failure the user actually hit, read the other way round: with a
 * revalidating cache, a stale ETag accepted for the newly selected clip would
 * pin the overlay to the old video no matter how many times you refresh. Checked
 * across every library entry (via /media/<id>, so the run never rewrites the
 * user's selection file), asserting that different artifacts carry different
 * validators and that a foreign ETag is refused.
 *
 * The ETag is size+mtime, so two byte-identical copies DO share one — and that
 * is correct, not a collision: a 304 hands back the same bytes either way. The
 * assertion is therefore "distinct (size, mtime) implies distinct ETag", not
 * "all ETags differ".
 */
console.log('\nrevalidation across clips:')
{
  const etagById = new Map()
  for (const id of ids) {
    const r = await call(`${BASE}/media/${id}`)
    etagById.set(id, r.headers?.etag)
  }

  const etagByArtifact = new Map()
  let everyEtag = true
  for (const v of list.videos ?? []) {
    const e = etagById.get(v.id)
    if (typeof e !== 'string' || e.length < 3) everyEtag = false
    etagByArtifact.set(`${v.bytes}@${v.mtime}`, e)
  }
  const artifacts = [...etagByArtifact.keys()].length
  const validators = new Set([...etagByArtifact.values()])
  const okDistinct = everyEtag && validators.size === artifacts
  console.log(
    `  ${okDistinct ? 'ok  ' : 'FAIL'} ${ids.length} clip(s), ${artifacts} distinct artifact(s) -> ${validators.size} ETag(s)` +
      (okDistinct ? '' : ' — different artifacts share a validator, so the wrong video could be served'),
  )
  if (!okDistinct) failures.push('distinct artifacts do not have distinct ETags')

  // Two entries whose bytes differ: a stale validator must not be honoured.
  const pairs = []
  for (const a of list.videos ?? []) {
    for (const b of list.videos ?? []) {
      if (a.id !== b.id && a.bytes !== b.bytes) pairs.push([a.id, b.id])
    }
  }
  if (pairs.length > 0 && okDistinct) {
    const [a, b] = pairs[0]
    const r = await call(`${BASE}/media/${b}`, 'GET', { 'if-none-match': etagById.get(a) })
    const ok200 = r.code === 200
    console.log(`  ${ok200 ? 'ok  ' : 'FAIL'} /media/${b} with ${a}'s ETag -> ${r.code} (want 200)`)
    if (!ok200) {
      failures.push(`a foreign ETag was accepted for ${b} (got ${r.code}) — refresh would keep the old video`)
    }
  } else if (pairs.length === 0) {
    console.log('  skip  only one distinct clip present; cross-clip check needs two')
  }
}

console.log('')
if (failures.length === 0) {
  console.log('all route checks passed')
  process.exit(0)
}
console.log(`${failures.length} route check(s) failed:`)
for (const f of failures) console.log('  - ' + f)
process.exit(1)
