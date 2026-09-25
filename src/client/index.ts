/**
 * @dsh-external/dsh-boot-animation - browser half.
 *
 * Plays the boot video full-frame in two cases:
 *   1. the conversation the user PINNED as their intro session, EVERY time it is
 *      opened (that is the "professional work mode" conversation they return to);
 *   2. a brand new, still-empty conversation, once per conversation.
 *
 * The pin exists because a specific conversation cannot be identified by name
 * from the client: session titles are not part of the session summary the client
 * holds, and asking a human for a session UUID is not a workflow. So the sidebar
 * footer gets one small button that pins whatever conversation is open.
 *
 * Seating:
 *   - `shell.overlay`        the frame-wide floating layer for the animation
 *   - `sidebar.footer.action` the small pin toggle beside Settings
 * Both are list slots, so each is an added cell, never a replacement.
 *
 * Which session is current comes from the ui-session service. Its
 * `adapter.current` store resolves to `{ key, hooks, keyedHooks, props }`, i.e.
 * `props.sessionId` and `hooks.session`. A brand new conversation is
 * `hooks.session.blankBit === true` (`blank` belongs to another package's
 * projected summary and is not on this snapshot).
 *
 * Browser policy, honestly: audio autoplay and the Fullscreen API both require a
 * user gesture, so the animation starts muted inside a fixed full-frame overlay
 * and a click then unmutes AND enters real fullscreen.
 */

import { createElement as h, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

/** Slot service for both seats, ui-session for the current conversation. */
export const inject = ['slots', 'uiSession']

const VIDEO_URL = '/dsh-boot-animation/boot.mp4'
const SEEN_KEY = 'dsh-boot-animation:seen'
const PIN_KEY = 'dsh-boot-animation:pinned'
const MAX_SEEN = 80
/** Never let a stalled video trap the user behind the overlay. */
const STALL_TIMEOUT_MS = 25000

/** Set to true to narrate the plugin's decisions in the browser console. */
const DEBUG = false
function log(...args: unknown[]): void {
  if (!DEBUG) return
  try {
    const text = args
      .map((a) => {
        if (typeof a === 'object' && a !== null) {
          try {
            return JSON.stringify(a)
          } catch {
            return String(a)
          }
        }
        return String(a)
      })
      .join(' ')
    console.log('[dsh-boot-animation] ' + text)
  } catch {
    /* console unavailable */
  }
}

function readSeen(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SEEN_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : []
  } catch {
    return []
  }
}

function hasPlayed(sessionId: string): boolean {
  return readSeen().includes(sessionId)
}

function markPlayed(sessionId: string): void {
  try {
    const seen = readSeen()
    if (!seen.includes(sessionId)) seen.push(sessionId)
    while (seen.length > MAX_SEEN) seen.shift()
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(seen))
  } catch {
    /* private mode: it simply replays next time */
  }
}

function readPinned(): string | null {
  try {
    const value = window.localStorage.getItem(PIN_KEY)
    return value === null || value === '' ? null : value
  } catch {
    return null
  }
}

function writePinned(sessionId: string | null): void {
  try {
    if (sessionId === null) window.localStorage.removeItem(PIN_KEY)
    else window.localStorage.setItem(PIN_KEY, sessionId)
  } catch {
    /* private mode: the pin simply does not persist */
  }
}

const STYLE_ID = 'dsh-boot-animation-style'
const CSS = `
.dba-root{position:fixed;inset:0;z-index:2147483000;background:#000;
  display:flex;align-items:center;justify-content:center;
  pointer-events:auto;cursor:pointer;overflow:hidden}
.dba-video{width:100%;height:100%;object-fit:contain;background:#000;display:block}
.dba-skip{position:absolute;top:20px;right:22px;z-index:2;
  border:1px solid rgba(255,255,255,.42);background:rgba(0,0,0,.42);
  color:#fff;border-radius:999px;padding:6px 16px;font-size:13px;line-height:1.4;
  font-family:inherit;cursor:pointer}
.dba-skip:hover{background:rgba(0,0,0,.66)}
.dba-hint{position:absolute;bottom:30px;left:50%;transform:translateX(-50%);
  z-index:2;color:rgba(255,255,255,.82);font-size:13px;letter-spacing:.06em;
  font-family:inherit;text-shadow:0 1px 8px rgba(0,0,0,.9);
  animation:dba-breathe 2.4s ease-in-out infinite;white-space:nowrap}
@keyframes dba-breathe{0%,100%{opacity:.55}50%{opacity:1}}
.dba-pin{display:inline-flex;align-items:center;justify-content:center;
  width:28px;height:28px;padding:0;border:0;border-radius:8px;cursor:pointer;
  background:transparent;color:var(--dsw-alias-text-secondary,#888);
  font-size:14px;line-height:1;font-family:inherit}
.dba-pin:hover{background:rgba(127,127,127,.16);color:var(--dsw-alias-text-primary,#191919)}
.dba-pin.dba-pin-on{color:#07c160;background:rgba(7,193,96,.14)}
`

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
}

type CurrentStore = {
  getSnapshot: () => unknown
  subscribe: (listener: () => void) => () => void
}

/** Resolved ui-session binding as the built-in source publishes it. */
type Binding = {
  key?: unknown
  hooks?: {
    session?: {
      /** The snapshot's own "this conversation is still empty" flag. */
      blankBit?: unknown
    }
  }
  keyedHooks?: unknown
  props?: { sessionId?: unknown }
}

const noopSubscribe = () => () => {}

/** Subscribe to the current-conversation store, tolerating its absence. */
function useCurrentSession(store: CurrentStore | null): {
  sessionId: string | null
  isNewConversation: boolean
} {
  const binding = useSyncExternalStore(
    store === null ? noopSubscribe : store.subscribe,
    store === null ? () => null : store.getSnapshot,
  ) as Binding | null
  const sessionId = typeof binding?.props?.sessionId === 'string' ? binding.props.sessionId : null
  return { sessionId, isNewConversation: binding?.hooks?.session?.blankBit === true }
}

function BootOverlay({ store }: { store: CurrentStore | null }): unknown {
  ensureStyle()

  const { sessionId, isNewConversation } = useCurrentSession(store)

  const [showing, setShowing] = useState(false)
  const [needsTap, setNeedsTap] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const closedRef = useRef(false)
  const lastSessionRef = useRef<string | null>(null)

  const close = useCallback(() => {
    closedRef.current = true
    setShowing(false)
    const video = videoRef.current
    if (video !== null) {
      try {
        video.pause()
      } catch {
        /* already stopped */
      }
    }
    if (document.fullscreenElement !== null && document.exitFullscreen !== undefined) {
      document.exitFullscreen().catch(() => {})
    }
  }, [])

  const open = useCallback(() => {
    closedRef.current = false
    setNeedsTap(false)
    setShowing(true)
  }, [])

  // Fire on every ENTRY into a conversation, not on every re-render.
  useEffect(() => {
    if (sessionId === null) return
    const entered = lastSessionRef.current !== sessionId
    lastSessionRef.current = sessionId
    if (!entered) return

    const pinned = readPinned()
    if (pinned !== null && pinned === sessionId) {
      // The designated conversation: every time it is opened.
      log('pinned session opened', sessionId)
      open()
      return
    }
    if (isNewConversation && !hasPlayed(sessionId)) {
      markPlayed(sessionId)
      log('new conversation', sessionId)
      open()
    }
  }, [sessionId, isNewConversation, open])

  // Start playback explicitly: relying on the autoplay attribute alone is
  // fragile, and a rejected play() has to surface as a tappable state.
  useEffect(() => {
    if (!showing) return undefined
    const video = videoRef.current
    if (video === null) return undefined
    video.muted = true
    const attempt = video.play()
    if (attempt !== undefined && typeof attempt.then === 'function') {
      attempt.then(() => log('play started')).catch((error: unknown) => {
        log('play rejected', String(error))
        setNeedsTap(true)
      })
    }
    const guard = window.setTimeout(() => {
      if (!closedRef.current) close()
    }, STALL_TIMEOUT_MS)
    return () => window.clearTimeout(guard)
  }, [showing, close])

  if (!showing) return null

  const activate = () => {
    const video = videoRef.current
    if (video === null) return
    if (needsTap) {
      setNeedsTap(false)
      video.muted = false
      const attempt = video.play()
      if (attempt !== undefined && typeof attempt.catch === 'function') attempt.catch(() => {})
    } else if (video.muted) {
      video.muted = false
    }
    if (document.fullscreenElement === null && typeof video.requestFullscreen === 'function') {
      video.requestFullscreen().catch(() => {})
    }
  }

  return h(
    'div',
    { className: 'dba-root', onClick: activate },
    h('video', {
      ref: videoRef,
      className: 'dba-video',
      src: VIDEO_URL,
      muted: true,
      autoPlay: true,
      playsInline: true,
      preload: 'auto',
      onEnded: close,
      onError: () => {
        const video = videoRef.current
        log('video error', video?.error?.code, video?.error?.message)
        close()
      },
      onClick: (event: { stopPropagation: () => void }) => event.stopPropagation(),
    }),
    h(
      'button',
      {
        type: 'button',
        className: 'dba-skip',
        onClick: (event: { stopPropagation: () => void }) => {
          event.stopPropagation()
          close()
        },
      },
      '跳过',
    ),
    h('div', { className: 'dba-hint' }, needsTap ? '点击播放' : '点击开启声音 · 全屏'),
  )
}

/** The pin toggle that lives beside Settings at the sidebar foot. */
function PinAction({ store }: { store: CurrentStore | null }): unknown {
  ensureStyle()
  const { sessionId } = useCurrentSession(store)
  const [pinned, setPinned] = useState<string | null>(() => readPinned())
  const isPinned = sessionId !== null && pinned === sessionId

  const toggle = () => {
    const next = isPinned ? null : sessionId
    writePinned(next)
    setPinned(next)
    log('pin toggled', { from: pinned, to: next })
  }

  const title = isPinned
    ? '这个会话已设为片头会话：每次打开都会播放片头动画（点击取消）'
    : '把这个会话设为片头会话：以后每次打开它都会播放片头动画'

  return h(
    'button',
    {
      type: 'button',
      className: isPinned ? 'dba-pin dba-pin-on' : 'dba-pin',
      title,
      'aria-label': title,
      disabled: sessionId === null,
      onClick: toggle,
    },
    isPinned ? '🎬' : '🎞',
  )
}

type ClientContext = {
  slots: {
    inject: (name: string, register: () => unknown) => unknown
    register: (options: Record<string, unknown>, component: unknown) => unknown
  }
  uiSession?: { adapter?: { current?: CurrentStore } }
  effect?: (callback: () => unknown, label?: string) => unknown
}

export function apply(ctx: ClientContext): void {
  const candidate = ctx.uiSession?.adapter?.current
  const store =
    candidate !== undefined &&
    typeof candidate.getSnapshot === 'function' &&
    typeof candidate.subscribe === 'function'
      ? candidate
      : null
  log('apply', { hasUiSession: ctx.uiSession !== undefined, hasStore: store !== null })

  const Overlay = () => BootOverlay({ store })
  const Pin = () => PinAction({ store })

  // Slot names are inlined on purpose: the injector's pre-flight check reads
  // register() calls statically and cannot follow a constant.
  const mount = () => {
    ctx.slots.inject('shell.overlay', () =>
      ctx.slots.register({ name: 'shell.overlay', id: 'dsh-boot-animation', order: 900 }, Overlay),
    )
    ctx.slots.inject('sidebar.footer.action', () =>
      ctx.slots.register(
        { name: 'sidebar.footer.action', id: 'dsh-boot-animation-pin', order: 40, label: () => '片头动画' },
        Pin,
      ),
    )
  }
  if (typeof ctx.effect === 'function') ctx.effect(mount, 'dsh-boot-animation: mounts')
  else mount()
}
