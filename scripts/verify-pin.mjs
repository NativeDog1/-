/**
 * verify-pin.mjs - prove the pinned conversation replays the intro EVERY open.
 *
 * Disambiguation trick: the new-conversation rule is suppressed by marking the
 * session as already seen, so if the overlay still comes up after a fresh page
 * load into that conversation, only the PIN rule can be responsible.
 *
 * Usage: node scripts/verify-pin.mjs <debugPort> <guiUrl>
 */

const port = Number(process.argv[2] ?? 9355)
const url = process.argv[3]
if (url === undefined) {
  console.error('usage: node scripts/verify-pin.mjs <debugPort> <guiUrl>')
  process.exit(2)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitForPage(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      const page = targets.find((t) => t.type === 'page' && typeof t.webSocketDebuggerUrl === 'string')
      if (page !== undefined) return page
    } catch {
      /* starting */
    }
    await sleep(500)
  }
  throw new Error('no debuggable page target')
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl)
    const pending = new Map()
    const exceptions = []
    let nextId = 0
    socket.onopen = () =>
      resolve({
        exceptions,
        send(method, params = {}) {
          return new Promise((res, rej) => {
            const id = (nextId += 1)
            pending.set(id, { res, rej })
            socket.send(JSON.stringify({ id, method, params }))
          })
        },
        close: () => socket.close(),
      })
    socket.onerror = (e) => reject(new Error('ws error ' + String(e?.message ?? e)))
    socket.onmessage = (event) => {
      let m
      try {
        m = JSON.parse(String(event.data))
      } catch {
        return
      }
      if (m.id !== undefined && pending.has(m.id)) {
        const entry = pending.get(m.id)
        pending.delete(m.id)
        if (m.error !== undefined) entry.rej(new Error(JSON.stringify(m.error)))
        else entry.res(m.result)
        return
      }
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails ?? {}
        exceptions.push(String(d.exception?.description ?? d.text ?? 'unknown'))
      }
    }
  })
}

async function evaluate(client, expression) {
  const r = await client.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r?.exceptionDetails !== undefined) throw new Error('page threw: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
  return r?.result?.value
}

async function waitTrue(client, expression, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if (await evaluate(client, expression)) return true
    } catch {
      /* navigating */
    }
    await sleep(600)
  }
  return false
}

const PIN = `window.localStorage.getItem('dsh-boot-animation:pinned')`
const SEEN = `window.localStorage.getItem('dsh-boot-animation:seen')`

const page = await waitForPage()
const client = await connect(page.webSocketDebuggerUrl)
await client.send('Runtime.enable')
await client.send('Page.enable')

async function load() {
  await client.send('Page.navigate', { url })
  await waitTrue(client, `document.querySelector('.dba-pin') !== null`, 75000)
  await sleep(1500)
}

await load()

// 1. Open a real conversation so the pin has a session to attach to.
const opened = await evaluate(
  client,
  `(() => {
     const b = Array.from(document.querySelectorAll('button')).find((el) => (el.getAttribute('aria-label') || '') === '新建会话');
     if (!b) return 'no new-session button';
     b.click();
     return 'clicked';
   })()`,
)
console.log('1 open a session   :', opened)
await waitTrue(client, `document.querySelector('.dba-root') !== null`, 20000)
const firstOverlay = await evaluate(client, `document.querySelectorAll('.dba-root').length`)
console.log('  new-conv overlay :', firstOverlay === 1 ? 'played (expected for a blank conversation)' : 'did not play')
await evaluate(client, `(() => { const b = document.querySelector('.dba-skip'); if (b) b.click() })()`)
await sleep(800)

// 2. Pin the conversation that is now open.
const before = await evaluate(client, `JSON.stringify({ pinned: ${PIN}, disabled: document.querySelector('.dba-pin').disabled })`)
console.log('2 pin before       :', before)
await evaluate(client, `document.querySelector('.dba-pin').click()`)
await sleep(600)
const after = await evaluate(client, `JSON.stringify({ pinned: ${PIN}, cls: document.querySelector('.dba-pin').className })`)
console.log('  pin after        :', after)

// 3. Block the new-conversation rule for that session.
const armed = await evaluate(
  client,
  `(() => {
     const pinned = ${PIN};
     if (!pinned) return 'no pin';
     window.localStorage.setItem('dsh-boot-animation:seen', JSON.stringify([pinned]));
     return JSON.stringify({ pinned, seen: JSON.parse(window.localStorage.getItem('dsh-boot-animation:seen')) });
   })()`,
)
console.log('3 suppress new-conv:', armed)

// 4. Fresh load straight into the pinned conversation.
await evaluate(client, `window.localStorage.removeItem('dsh-boot-animation:seen')`)
await evaluate(client, `window.localStorage.setItem('dsh-boot-animation:seen', JSON.stringify([${PIN}]))`)
await load()

const state = await evaluate(
  client,
  `JSON.stringify({ pinned: ${PIN}, seen: ${SEEN}, pinDisabled: document.querySelector('.dba-pin') ? document.querySelector('.dba-pin').disabled : null })`,
)
console.log('4 after reload     :', state)

const replayed = await evaluate(client, `document.querySelectorAll('.dba-root').length`)
console.log('  overlay present  :', replayed === 1 ? 'YES -> the PIN rule fired' : 'no')

const video = await evaluate(
  client,
  `(() => {
     const v = document.querySelector('.dba-video');
     return v ? JSON.stringify({ paused: v.paused, duration: v.duration, w: v.videoWidth }) : 'no video';
   })()`,
)
console.log('  video            :', video)

console.log('\nuncaught exceptions:', client.exceptions.length === 0 ? '(none)' : client.exceptions.slice(0, 4))
client.close()
process.exit(0)
