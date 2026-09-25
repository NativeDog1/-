window.__ModuleLoader__.load({
	id: "dsh-boot-animation",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region src/client/index.ts
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
		/** Slot service for both seats, ui-session for the current conversation. */
		const inject = ["slots", "uiSession"];
		const VIDEO_URL = "/dsh-boot-animation/boot.mp4";
		const SEEN_KEY = "dsh-boot-animation:seen";
		const PIN_KEY = "dsh-boot-animation:pinned";
		const MAX_SEEN = 80;
		/** Never let a stalled video trap the user behind the overlay. */
		const STALL_TIMEOUT_MS = 25e3;
		function readSeen() {
			try {
				const parsed = JSON.parse(window.localStorage.getItem(SEEN_KEY) ?? "[]");
				return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : [];
			} catch {
				return [];
			}
		}
		function hasPlayed(sessionId) {
			return readSeen().includes(sessionId);
		}
		function markPlayed(sessionId) {
			try {
				const seen = readSeen();
				if (!seen.includes(sessionId)) seen.push(sessionId);
				while (seen.length > MAX_SEEN) seen.shift();
				window.localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
			} catch {}
		}
		function readPinned() {
			try {
				const value = window.localStorage.getItem(PIN_KEY);
				return value === null || value === "" ? null : value;
			} catch {
				return null;
			}
		}
		function writePinned(sessionId) {
			try {
				if (sessionId === null) window.localStorage.removeItem(PIN_KEY);
				else window.localStorage.setItem(PIN_KEY, sessionId);
			} catch {}
		}
		const STYLE_ID = "dsh-boot-animation-style";
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
`;
		function ensureStyle() {
			if (document.getElementById(STYLE_ID) !== null) return;
			const style = document.createElement("style");
			style.id = STYLE_ID;
			style.textContent = CSS;
			document.head.appendChild(style);
		}
		const noopSubscribe = () => () => {};
		/** Subscribe to the current-conversation store, tolerating its absence. */
		function useCurrentSession(store) {
			const binding = (0, react.useSyncExternalStore)(store === null ? noopSubscribe : store.subscribe, store === null ? () => null : store.getSnapshot);
			return {
				sessionId: typeof binding?.props?.sessionId === "string" ? binding.props.sessionId : null,
				isNewConversation: binding?.hooks?.session?.blankBit === true
			};
		}
		function BootOverlay({ store }) {
			ensureStyle();
			const { sessionId, isNewConversation } = useCurrentSession(store);
			const [showing, setShowing] = (0, react.useState)(false);
			const [needsTap, setNeedsTap] = (0, react.useState)(false);
			const videoRef = (0, react.useRef)(null);
			const closedRef = (0, react.useRef)(false);
			const lastSessionRef = (0, react.useRef)(null);
			const close = (0, react.useCallback)(() => {
				closedRef.current = true;
				setShowing(false);
				const video = videoRef.current;
				if (video !== null) try {
					video.pause();
				} catch {}
				if (document.fullscreenElement !== null && document.exitFullscreen !== void 0) document.exitFullscreen().catch(() => {});
			}, []);
			const open = (0, react.useCallback)(() => {
				closedRef.current = false;
				setNeedsTap(false);
				setShowing(true);
			}, []);
			(0, react.useEffect)(() => {
				if (sessionId === null) return;
				const entered = lastSessionRef.current !== sessionId;
				lastSessionRef.current = sessionId;
				if (!entered) return;
				const pinned = readPinned();
				if (pinned !== null && pinned === sessionId) {
					open();
					return;
				}
				if (isNewConversation && !hasPlayed(sessionId)) {
					markPlayed(sessionId);
					open();
				}
			}, [
				sessionId,
				isNewConversation,
				open
			]);
			(0, react.useEffect)(() => {
				if (!showing) return void 0;
				const video = videoRef.current;
				if (video === null) return void 0;
				video.muted = true;
				const attempt = video.play();
				if (attempt !== void 0 && typeof attempt.then === "function") attempt.then(() => void 0).catch((error) => {
					setNeedsTap(true);
				});
				const guard = window.setTimeout(() => {
					if (!closedRef.current) close();
				}, STALL_TIMEOUT_MS);
				return () => window.clearTimeout(guard);
			}, [showing, close]);
			if (!showing) return null;
			const activate = () => {
				const video = videoRef.current;
				if (video === null) return;
				if (needsTap) {
					setNeedsTap(false);
					video.muted = false;
					const attempt = video.play();
					if (attempt !== void 0 && typeof attempt.catch === "function") attempt.catch(() => {});
				} else if (video.muted) video.muted = false;
				if (document.fullscreenElement === null && typeof video.requestFullscreen === "function") video.requestFullscreen().catch(() => {});
			};
			return (0, react.createElement)("div", {
				className: "dba-root",
				onClick: activate
			}, (0, react.createElement)("video", {
				ref: videoRef,
				className: "dba-video",
				src: VIDEO_URL,
				muted: true,
				autoPlay: true,
				playsInline: true,
				preload: "auto",
				onEnded: close,
				onError: () => {
					const video = videoRef.current;
					video?.error?.code, video?.error?.message;
					close();
				},
				onClick: (event) => event.stopPropagation()
			}), (0, react.createElement)("button", {
				type: "button",
				className: "dba-skip",
				onClick: (event) => {
					event.stopPropagation();
					close();
				}
			}, "跳过"), (0, react.createElement)("div", { className: "dba-hint" }, needsTap ? "点击播放" : "点击开启声音 · 全屏"));
		}
		/** The pin toggle that lives beside Settings at the sidebar foot. */
		function PinAction({ store }) {
			ensureStyle();
			const { sessionId } = useCurrentSession(store);
			const [pinned, setPinned] = (0, react.useState)(() => readPinned());
			const isPinned = sessionId !== null && pinned === sessionId;
			const toggle = () => {
				const next = isPinned ? null : sessionId;
				writePinned(next);
				setPinned(next);
			};
			const title = isPinned ? "这个会话已设为片头会话：每次打开都会播放片头动画（点击取消）" : "把这个会话设为片头会话：以后每次打开它都会播放片头动画";
			return (0, react.createElement)("button", {
				type: "button",
				className: isPinned ? "dba-pin dba-pin-on" : "dba-pin",
				title,
				"aria-label": title,
				disabled: sessionId === null,
				onClick: toggle
			}, isPinned ? "🎬" : "🎞");
		}
		function apply(ctx) {
			const candidate = ctx.uiSession?.adapter?.current;
			const store = candidate !== void 0 && typeof candidate.getSnapshot === "function" && typeof candidate.subscribe === "function" ? candidate : null;
			ctx.uiSession;
			const Overlay = () => BootOverlay({ store });
			const Pin = () => PinAction({ store });
			const mount = () => {
				ctx.slots.inject("shell.overlay", () => ctx.slots.register({
					name: "shell.overlay",
					id: "dsh-boot-animation",
					order: 900
				}, Overlay));
				ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
					name: "sidebar.footer.action",
					id: "dsh-boot-animation-pin",
					order: 40,
					label: () => "片头动画"
				}, Pin));
			};
			if (typeof ctx.effect === "function") ctx.effect(mount, "dsh-boot-animation: mounts");
			else mount();
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map