window.__ModuleLoader__.load({
	id: "dsh-boot-animation",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region src/client/index.ts
		/** Slot service for both seats, ui-session for the current conversation. */
		const inject = ["slots", "uiSession"];
		/**
		* Plays the active clip.
		*
		* The src is a CONSTANT. It used to carry `#<activeId>` so the element would
		* reload when the library selection changed, but the id arrives from an async
		* fetch, so the src changed a moment AFTER the overlay opened — mid-playback.
		* A src change restarts the media load, and the play() effect does not re-run
		* on it, so the result was a black frame that looked like "the video will not
		* load". The fragment bought nothing: the route resolves the active file on
		* every request, so the next time the overlay opens it is already the new clip.
		*/
		const VIDEO_URL = "/dsh-boot-animation/boot.mp4";
		const LIST_URL = "/dsh-boot-animation/videos.json";
		const SELECT_URL = "/dsh-boot-animation/select";
		const SEEN_KEY = "dsh-boot-animation:seen";
		const PIN_KEY = "dsh-boot-animation:pinned";
		const FIT_KEY = "dsh-boot-animation:fit";
		const MAX_SEEN = 80;
		/** Never let a stalled video trap the user behind the overlay. */
		const STALL_TIMEOUT_MS = 25e3;
		function readFit() {
			try {
				return window.localStorage.getItem(FIT_KEY) === "contain" ? "contain" : "cover";
			} catch {
				return "cover";
			}
		}
		function writeFit(fit) {
			try {
				window.localStorage.setItem(FIT_KEY, fit);
			} catch {}
		}
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
/* The ONLY difference between the fit modes is object-fit.
   Do not "harden" this with position/inset changes: the bar fix does not need
   them, and an overlay that rendered correctly under flex + percentage sizing
   went fully black in the real app the one time the layout mechanics were
   rewritten for no reason. Minimal change, or you trade a cosmetic defect for
   a functional one.
   NOTE: never put a backtick in this block — the whole sheet is a template
   literal, and one backtick ends it. scripts/check-css-template.mjs enforces it. */
.dba-video.dba-cover{object-fit:cover;object-position:center}
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
.dba-veil{position:fixed;inset:0;z-index:2147483200;background:rgba(0,0,0,.46);
  display:flex;align-items:center;justify-content:center;padding:24px}
.dba-lib{width:min(560px,100%);max-height:min(76vh,640px);overflow:auto;
  background:var(--dsw-alias-bg-elevated,#fff);color:var(--dsw-alias-text-primary,#191919);
  border:1px solid rgba(127,127,127,.28);border-radius:14px;padding:18px 18px 14px;
  box-shadow:0 18px 60px rgba(0,0,0,.34);font-family:inherit;
  font-size:13px;line-height:1.55}
.dba-lib h3{margin:0 0 4px;font-size:15px;font-weight:600}
.dba-lib p{margin:0 0 12px;color:var(--dsw-alias-text-secondary,#777);font-size:12.5px}
.dba-item{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:9px;
  cursor:pointer;border:1px solid transparent}
.dba-item:hover{background:rgba(127,127,127,.12)}
.dba-item.dba-cur{border-color:rgba(7,193,96,.55);background:rgba(7,193,96,.10)}
.dba-item .dba-nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dba-badge{font-size:11px;padding:1px 7px;border-radius:999px;
  background:rgba(127,127,127,.18);color:var(--dsw-alias-text-secondary,#777);white-space:nowrap}
.dba-badge.dba-b-sel{background:rgba(7,193,96,.16);color:#07974b}
.dba-badge.dba-b-warn{background:rgba(210,120,40,.18);color:#b46214;cursor:help}
.dba-meta{font-size:11.5px;color:var(--dsw-alias-text-secondary,#999);white-space:nowrap}
.dba-mark{width:16px;text-align:center;color:#07c160;font-weight:700}
.dba-dir{margin:12px 0 0;padding:9px 10px;border-radius:9px;background:rgba(127,127,127,.10);
  font-size:11.5px;color:var(--dsw-alias-text-secondary,#777);word-break:break-all}
.dba-dir code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11.5px;
  color:var(--dsw-alias-text-primary,#333)}
.dba-bar{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}
.dba-fit{display:flex;align-items:center;gap:8px;margin-top:12px;
  font-size:12px;color:var(--dsw-alias-text-secondary,#777)}
.dba-btn.dba-btn-on{border-color:rgba(7,193,96,.6);background:rgba(7,193,96,.12);color:#07974b}
.dba-btn.dba-btn-preview{border-color:rgba(7,193,96,.55);color:#07974b;font-weight:600}
.dba-btn.dba-btn-preview:hover{background:rgba(7,193,96,.12)}
.dba-btn{border:1px solid rgba(127,127,127,.34);background:transparent;color:inherit;
  border-radius:8px;padding:5px 14px;font-size:12.5px;font-family:inherit;cursor:pointer}
.dba-btn:hover{background:rgba(127,127,127,.14)}
.dba-msg{margin-top:10px;font-size:12px;min-height:16px;color:var(--dsw-alias-text-secondary,#777)}
.dba-msg.dba-ok{color:#07974b}
.dba-msg.dba-err{color:#d24a43}
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
		function BootOverlay({ store, previewAt = 0 }) {
			ensureStyle();
			const { sessionId, isNewConversation } = useCurrentSession(store);
			const fit = readFit();
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
				if (previewAt === 0) return;
				open();
			}, [previewAt, open]);
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
				className: fit === "cover" ? "dba-video dba-cover" : "dba-video",
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
		function PinAction({ store, onOpen }) {
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
			return (0, react.createElement)("span", {
				className: "dba-pin-wrap",
				style: {
					display: "inline-flex",
					alignItems: "center"
				}
			}, (0, react.createElement)("button", {
				type: "button",
				className: isPinned ? "dba-pin dba-pin-on" : "dba-pin",
				title,
				"aria-label": title,
				disabled: sessionId === null,
				onClick: toggle
			}, isPinned ? "🎬" : "🎞"), (0, react.createElement)("button", {
				type: "button",
				className: "dba-pin dba-lib-open",
				title: "片头片库：查看、切换或添加片头视频",
				"aria-label": "打开片头片库",
				onClick: onOpen
			}, "🎛"));
		}
		function formatBytes(n) {
			if (!Number.isFinite(n) || n <= 0) return "0 B";
			if (n < 1024) return n + " B";
			if (n < 1048576) return (n / 1024).toFixed(0) + " KB";
			return (n / 1024 / 1024).toFixed(2) + " MB";
		}
		const SOURCE_LABEL = {
			yours: "你自己加的",
			shipped: "插件自带",
			bundled: "内置原始",
			env: "环境变量"
		};
		/**
		* The video library: every .mp4 the host can see, the active one marked, and a
		* click to switch. Adding a video stays a filesystem action — the user drops a
		* file in and presses refresh — because a browser-side upload would have to
		* carry the bytes through this route for no gain on a local-only plugin.
		*/
		function VideoLibrary({ onClose, onPreview }) {
			ensureStyle();
			const [state, setState] = (0, react.useState)(null);
			const [fit, setFit] = (0, react.useState)(() => readFit());
			const [msg, setMsg] = (0, react.useState)({
				text: "",
				kind: ""
			});
			const [busy, setBusy] = (0, react.useState)(false);
			const load = (0, react.useCallback)(async () => {
				try {
					const data = await (await fetch(LIST_URL, { cache: "no-store" })).json();
					setState(data);
					setMsg({
						text: "",
						kind: ""
					});
				} catch (error) {
					setMsg({
						text: "读取片库失败：" + String(error),
						kind: "dba-err"
					});
				}
			}, []);
			(0, react.useEffect)(() => {
				load();
			}, [load]);
			(0, react.useEffect)(() => {
				const onKey = (event) => {
					if (event.key === "Escape") onClose();
				};
				window.addEventListener("keydown", onKey);
				return () => window.removeEventListener("keydown", onKey);
			}, [onClose]);
			const choose = (0, react.useCallback)(async (id) => {
				setBusy(true);
				try {
					const data = await (await fetch(SELECT_URL, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ id })
					})).json();
					if (data.ok === true) {
						setMsg({
							text: "已切换：" + String(data.name ?? id) + "（下次播片头生效）",
							kind: "dba-ok"
						});
						await load();
					} else setMsg({
						text: "切换失败：" + String(data.error ?? "未知错误"),
						kind: "dba-err"
					});
				} catch (error) {
					setMsg({
						text: "切换失败：" + String(error),
						kind: "dba-err"
					});
				} finally {
					setBusy(false);
				}
			}, [load]);
			const videos = state === null ? [] : state.videos;
			const activeId = state === null ? null : state.activeId;
			return (0, react.createElement)("div", {
				className: "dba-veil",
				onClick: (event) => {
					if (event.target === event.currentTarget) onClose();
				}
			}, (0, react.createElement)("div", {
				className: "dba-lib",
				onClick: (event) => event.stopPropagation()
			}, (0, react.createElement)("h3", null, "片头片库"), (0, react.createElement)("p", null, "选中的那段会在下次播放片头时登场 —— 新对话、以及你钉住的会话。"), ...videos.length === 0 ? [(0, react.createElement)("div", { className: "dba-item" }, (0, react.createElement)("span", { className: "dba-nm" }, "（还没找到任何视频）"))] : videos.map((v) => (0, react.createElement)("div", {
				key: v.id,
				className: "dba-item" + (v.id === activeId ? " dba-cur" : ""),
				title: v.file,
				onClick: () => {
					if (!busy && v.id !== activeId) choose(v.id);
				}
			}, (0, react.createElement)("span", { className: "dba-mark" }, v.id === activeId ? "✓" : ""), (0, react.createElement)("span", { className: "dba-nm" }, v.name), v.legacy ? (0, react.createElement)("span", { className: "dba-badge" }, "原片源") : null, (v.ext === ".mp4" || v.ext === ".m4v") && v.faststart === false ? (0, react.createElement)("span", {
				className: "dba-badge dba-b-warn",
				title: "这个文件的索引表(moov)在末尾：浏览器要整段下载完才出画面，容易黑屏。用 ffmpeg -c copy -movflags +faststart 重排一次即可。"
			}, "⚠ 未优化") : null, (0, react.createElement)("span", { className: "dba-badge" }, SOURCE_LABEL[v.source] ?? v.source), (0, react.createElement)("span", { className: "dba-meta" }, formatBytes(v.bytes)))), (0, react.createElement)("div", { className: "dba-dir" }, "想加自己的片子：把 mp4 放进这个文件夹，再点「刷新」", (0, react.createElement)("br", null), (0, react.createElement)("code", null, state === null ? "…" : state.userDir)), (0, react.createElement)("div", { className: "dba-fit" }, (0, react.createElement)("span", null, "播放时："), (0, react.createElement)("button", {
				type: "button",
				className: "dba-btn" + (fit === "cover" ? " dba-btn-on" : ""),
				title: "铺满整个窗口，超出部分裁掉 —— 不留黑边",
				onClick: () => {
					writeFit("cover");
					setFit("cover");
					setMsg({
						text: "已设为「铺满屏幕」：下次播放生效",
						kind: "dba-ok"
					});
				}
			}, "铺满屏幕"), (0, react.createElement)("button", {
				type: "button",
				className: "dba-btn" + (fit === "contain" ? " dba-btn-on" : ""),
				title: "完整显示整帧，长宽比不匹配时留黑边",
				onClick: () => {
					writeFit("contain");
					setFit("contain");
					setMsg({
						text: "已设为「完整显示」：下次播放生效",
						kind: "dba-ok"
					});
				}
			}, "完整显示")), (0, react.createElement)("div", { className: "dba-bar" }, (0, react.createElement)("button", {
				type: "button",
				className: "dba-btn dba-btn-preview",
				title: "立刻播放当前选中的这段，不用等下一次开新对话或钉住的会话",
				onClick: onPreview
			}, "▶ 预览当前"), (0, react.createElement)("button", {
				type: "button",
				className: "dba-btn",
				onClick: () => void load()
			}, "刷新"), (0, react.createElement)("button", {
				type: "button",
				className: "dba-btn",
				onClick: onClose
			}, "关闭")), (0, react.createElement)("div", { className: "dba-msg " + msg.kind }, msg.text)));
		}
		/**
		* Opens the library from outside the overlay's own React tree.
		*
		* The pin sits in a different slot than the overlay, so it cannot share React
		* state with the component that renders the dialog: they are two separate roots
		* that this plugin happens to register. A module-level listener pair is the
		* smallest honest bridge between them.
		*/
		const libraryOpeners = /* @__PURE__ */ new Set();
		function openLibrary() {
			for (const open of libraryOpeners) try {
				open();
			} catch {}
		}
		function apply(ctx) {
			const candidate = ctx.uiSession?.adapter?.current;
			const store = candidate !== void 0 && typeof candidate.getSnapshot === "function" && typeof candidate.subscribe === "function" ? candidate : null;
			ctx.uiSession;
			const AppRoot = () => {
				const [libOpen, setLibOpen] = (0, react.useState)(false);
				const [previewAt, setPreviewAt] = (0, react.useState)(0);
				const openSelf = (0, react.useCallback)(() => setLibOpen(true), []);
				(0, react.useEffect)(() => {
					libraryOpeners.add(openSelf);
					return () => {
						libraryOpeners.delete(openSelf);
					};
				}, [openSelf]);
				if (libOpen) return (0, react.createElement)(VideoLibrary, {
					onClose: () => setLibOpen(false),
					onPreview: () => {
						setLibOpen(false);
						setPreviewAt((n) => n + 1);
					}
				});
				return (0, react.createElement)(BootOverlay, {
					store,
					previewAt
				});
			};
			const Pin = () => (0, react.createElement)(PinAction, {
				store,
				onOpen: () => openLibrary()
			});
			const mount = () => {
				ctx.slots.inject("shell.overlay", () => ctx.slots.register({
					name: "shell.overlay",
					id: "dsh-boot-animation",
					order: 900
				}, AppRoot));
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