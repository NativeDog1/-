# dsh-boot-animation

A **boot animation** for DSH: when you open a new conversation — or a conversation
you pinned — a video plays full-frame in the app window.

> 中文: [README.md](README.md)

- Plays **once per new conversation** by default
- **Or every time** you open a conversation you pinned (one click in the sidebar footer)
- Fills the whole window, skippable, closes itself when it ends
- **Bring your own video** (three ways, below)

## Install

```sh
dsh plugin --profile web add github:NativeDog1/-
```

> The built output (`lib/`) is committed and the package has no `prepare`
> lifecycle script, so this installs **without compiling anything** and without
> tripping pnpm's `allowBuilds` build-approval prompt.
> (Once the package is on npm, `dsh plugin --profile web add dsh-boot-animation` works too.)

Then **restart the DSH service once** — bundle layers are assembled at boot:

```sh
# stop the running `dsh web`, then
dsh web
```

### Nothing happens after installing? Do this first

DSH serves client bundles with `cache-control: max-age=31536000, immutable`, and
the `rev` in the URL is a **per-process nonce** that does not change with content.
Your browser therefore keeps the first copy it ever fetched.

Press **Ctrl+Shift+R** (hard reload) in the app window. A plain F5 is not enough.

## Usage

**New conversations** play it automatically, once each.

**Pin a conversation** to replay it on *every* open:

1. Open that conversation
2. Click the **🎞** icon at the sidebar foot (next to Settings)
3. It turns green **🎬** — pinned

Every later entry into that conversation replays the animation, including after
switching away and back, or reloading. Click again to unpin.

> If at startup your active main panel is not the conversation (e.g. some plugin's
> panel is showing), there is no current conversation yet and the pin is disabled.
> Open a conversation first.

## Use your own video

The host half looks for a non-empty file in this order, **re-resolving on every
request**, so swapping the file needs no restart:

| Order | Location |
|---|---|
| 1 | the file named by `DSH_BOOT_ANIMATION` |
| 2 | `$DSH_HOME/boot-animation/intro.mp4` (i.e. `~/.dsh/boot-animation/intro.mp4`) |
| 3 | the bundled `assets/boot.mp4` |

```sh
mkdir -p ~/.dsh/boot-animation
cp my-intro.mp4 ~/.dsh/boot-animation/intro.mp4
```

Check which one is in use:

```sh
curl http://127.0.0.1:3080/dsh-boot-animation/status.json
```

## Two browser policies you cannot avoid

Autoplay **with audio** and the **Fullscreen API** both require a user gesture.
So the animation starts **muted** inside a fixed full-frame overlay (already
visually fullscreen), and **one click** unmutes it *and* enters real fullscreen.
If even muted autoplay is refused, a "click to play" state is shown instead of a
black screen.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Nothing appears at all | Almost always the cache: **Ctrl+Shift+R**, or restart DSH |
| New conversation does not play | That conversation already played it (once per conversation). Pin it to replay every time |
| Pinned but still nothing | Check the pin is green, and that you opened the pinned conversation |
| Black screen | Open `/dsh-boot-animation/status.json` to see whether a source was found; check the console for a decode error |
| Want to see the decisions | Set `DEBUG = true` at the top of `src/client/index.ts`, rebuild, watch the console |

## Implementation notes

- Seats: `shell.overlay` (frame-wide floating layer, `kind: list`, additive) and
  `sidebar.footer.action` (the pin)
- The current conversation comes from `ctx.uiSession.adapter.current`, a
  React-friendly store whose snapshot is the **resolved descriptor output**
  `{ key, hooks, keyedHooks, props }` — the id is at `props.sessionId` and the
  session snapshot at `hooks.session`
- "Brand new conversation" is **`blankBit`** on that snapshot (`session.blank`
  lives on another package's projected summary, not here)
- "Every open" is implemented by watching **entry into** a conversation rather
  than remembering that it played, so a pinned conversation ignores the seen list
- The video route honours **Range** requests; browsers send them for media and
  may refuse to play when a 200 arrives where a 206 was expected

## License

BSD-3-Clause, see [LICENSE](LICENSE). The bundled `assets/boot.mp4` ships under
the same terms.
