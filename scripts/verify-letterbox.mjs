/**
 * verify-letterbox.mjs — measure, in a real browser, how much black the overlay
 * leaves around the clip.
 *
 * Why this exists: "there is a black bar" is a claim about RENDERED layout, and
 * reasoning about `object-fit` in the abstract got it wrong once already. This
 * drives Edge over CDP, puts the plugin's own overlay CSS and the plugin's own
 * video route in front of a real layout engine, and reads the numbers back:
 * the video element's box, the viewport it sits in, and the letterbox the
 * chosen `object-fit` actually produces.
 *
 * It also reproduces the everyday cause of the bars: a browser viewport is NOT
 * the clip's aspect ratio, because window chrome takes height away. A 16:9 clip
 * on a 16:9 screen is still letterboxed.
 *
 * Usage: node scripts/verify-letterbox.mjs [--port 3080] [--width 2560] [--height 1400]
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const num = (name, fallback) => {
  const i = process.argv.indexOf(name)
  return i === -1 ? fallback : Number(process.argv[i + 1])
}

const PORT = num('--port', 3080)
const WIDTH = num('--width', 2560)
const HEIGHT = num('--height', 1400)
const DEBUG_PORT = 9400 + (process.pid % 150)
const OVERLAY_URL = `http://127.0.0.1:${PORT}/dsh-boot-animation/boot.mp4`

const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
]
const browser = BROWSERS.find((p) => existsSync(p))
if (browser === undefined) {
  console.error('verify-letterbox: no Edge/Chrome found in the usual locations')
  process.exit(2)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// --- page under test: the plugin's real CSS, the plugin's real video route ---
const page = `<!doctype html><meta charset="utf-8"><title>letterbox probe</title>
<style>
  html,body{margin:0;padding:0;overflow:hidden;background:#f0f}
  .dba-root{position:fixed;inset:0;z-index:2147483000;background:#000;
    pointer-events:auto;cursor:pointer;overflow:hidden}
  .dba-video{position:absolute;inset:0;width:100%;height:100%;
    object-fit:contain;background:#000;display:block}
  .dba-video.dba-cover{object-fit:cover;object-position:center}
</style>
<div class="dba-root"><video class="dba-video" id="v" src="${OVERLAY_URL}"
  muted autoplay playsinline preload="auto"></video></div>`

const dir = mkdtempSync(join(tmpdir(), 'dba-probe-'))
const pagePath = join(dir, 'probe.html')
writeFileSync(pagePath, page, 'utf8')
const pageUrl = 'file:///' + pagePath.replace(/\\/g, '/')

const child = spawn(
  browser,
  [
    '--headless=new',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${join(dir, 'profile')}`,
    `--window-size=${WIDTH},${HEIGHT}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--autoplay-policy=no-user-gesture-required',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

let socket
const handlers = new Map()
let nextId = 0

/** One CDP call over the page target's websocket. */
const call = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = (nextId += 1)
    handlers.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
    setTimeout(() => {
      if (handlers.has(id)) {
        handlers.delete(id)
        reject(new Error(`timeout: ${method}`))
      }
    }, 20000)
  })

async function findTarget() {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()
      const target = list.find((t) => t.type === 'page' && typeof t.webSocketDebuggerUrl === 'string')
      if (target !== undefined) return target.webSocketDebuggerUrl
    } catch {
      /* still starting */
    }
    await sleep(400)
  }
  throw new Error('no debug target appeared')
}

async function openSocket(url) {
  const ws = new WebSocket(url)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = (e) => reject(new Error('ws error ' + String(e?.message ?? e)))
  })
  ws.onmessage = (event) => {
    let m
    try {
      m = JSON.parse(String(event.data))
    } catch {
      return
    }
    if (m.id === undefined) return
    const h = handlers.get(m.id)
    if (h === undefined) return
    handlers.delete(m.id)
    if (m.error !== undefined) h.reject(new Error(JSON.stringify(m.error)))
    else h.resolve(m.result)
  }
  return ws
}

async function evaluate(expression) {
  const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r?.exceptionDetails !== undefined) {
    throw new Error('page threw: ' + JSON.stringify(r.exceptionDetails).slice(0, 240))
  }
  return r?.result?.value
}

const MEASURE = (mode) => `(() => {
  const v = document.getElementById('v');
  v.pause();
  v.className = 'dba-video' + (${JSON.stringify(mode)} === 'cover' ? ' dba-cover' : '');
  const r = v.getBoundingClientRect();
  const vw = v.videoWidth, vh = v.videoHeight;
  const fit = getComputedStyle(v).objectFit;
  const scale = fit === 'cover'
    ? Math.max(r.width / vw, r.height / vh)
    : Math.min(r.width / vw, r.height / vh);
  const drawnW = vw * scale, drawnH = vh * scale;
  // Black bars exist only when the drawn image is SMALLER than the element.
  // When it is larger (cover), the excess is cropped instead — that is padding,
  // not letterboxing, and reporting it as a bar is how a correct result got
  // read as a failure once.
  const barX = Math.max(0, Math.round((r.width - drawnW) / 2));
  const barY = Math.max(0, Math.round((r.height - drawnH) / 2));
  const cropX = Math.max(0, Math.round((drawnW - r.width) / 2));
  const cropY = Math.max(0, Math.round((drawnH - r.height) / 2));
  return JSON.stringify({
    mode: ${JSON.stringify(mode)},
    objectFit: fit,
    viewport: [window.innerWidth, window.innerHeight],
    elementBox: [Math.round(r.width), Math.round(r.height)],
    drawnImage: [Math.round(drawnW), Math.round(drawnH)],
    barX, barY, cropX, cropY,
    clip: [vw, vh],
    readyState: v.readyState,
    error: v.error ? v.error.code : null,
  });
})()`

try {
  socket = await openSocket(await findTarget())
  await call('Page.enable')
  await call('Runtime.enable')
  await call('Page.navigate', { url: pageUrl })

  const deadline = Date.now() + 30000
  let ready = false
  while (Date.now() < deadline) {
    const raw = await evaluate(MEASURE('cover'))
    const s = JSON.parse(raw)
    if (s.readyState >= 2 && s.clip[0] > 0) {
      console.log(`clip loaded: readyState=${s.readyState} clip=${s.clip.join('x')} video error=${s.error}`)
      ready = true
      break
    }
    await sleep(400)
  }
  if (!ready) console.log('WARNING: clip never reached readyState>=2 — measuring layout anyway')

  const cover = JSON.parse(await evaluate(MEASURE('cover')))
  const contain = JSON.parse(await evaluate(MEASURE('contain')))

  const fmt = (m) =>
    `  ${m.mode.padEnd(8)} object-fit=${m.objectFit.padEnd(8)} viewport=${m.viewport.join('x')} ` +
    `clip=${m.clip.join('x')} element=${m.elementBox.join('x')} drawn=${m.drawnImage.join('x')} ` +
    `→ black bar ${m.barX}px L/R, ${m.barY}px T/B` +
    (m.cropX > 0 || m.cropY > 0 ? ` (crops ${m.cropX}px L/R, ${m.cropY}px T/B)` : '')

  console.log('\nmeasured in the browser layout engine:')
  console.log(fmt(cover))
  console.log(fmt(contain))

  const failures = []
  if (cover.objectFit !== 'cover') failures.push(`fill mode resolved to object-fit:${cover.objectFit}`)
  if (cover.barX !== 0 || cover.barY !== 0) {
    failures.push(`fill mode still leaves ${cover.barX}px L/R and ${cover.barY}px T/B of black`)
  }
  if (cover.elementBox[0] !== cover.viewport[0] || cover.elementBox[1] !== cover.viewport[1]) {
    failures.push(`video element ${cover.elementBox.join('x')} does not fill viewport ${cover.viewport.join('x')}`)
  }
  if (contain.barX === 0 && contain.barY === 0) {
    failures.push('NOTE: at this viewport the two fit modes render identically — choose a size where they differ')
  }

  console.log('')
  if (failures.length === 0) {
    console.log('PASS: fill mode covers the whole viewport with no black bars')
    console.log(`      (whole-frame mode would leave ${contain.barX}px L/R, ${contain.barY}px T/B at this size)`)
  } else {
    console.log('FAIL:')
    for (const f of failures) console.log('  - ' + f)
    process.exitCode = 1
  }
} catch (error) {
  console.error('verify-letterbox failed:', String(error?.message ?? error))
  process.exitCode = 2
} finally {
  try {
    socket?.close()
  } catch {
    /* already closed */
  }
  child.kill()
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* leave the temp dir if it is locked */
  }
}
