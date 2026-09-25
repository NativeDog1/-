# dsh-boot-animation

给 DSH 加一段**开机动画**：打开一个新对话、或打开你指定的那个会话时，视频铺满整个窗口播放。

> English: [README.en.md](README.en.md)

- **一个会话只播一次**（新对话默认行为）
- **指定会话每次打开都播** —— 在侧边栏页脚点一下图钉即可
- **铺满窗口**、可跳过、放完自动关闭
- **可以换自己的片子**（三种方式，见下）

## 安装

```sh
dsh plugin --profile web add github:NativeDog1/dsh-boot-animation
```

> 仓库里已经提交了构建产物 `lib/`，也没有 `prepare` 生命周期脚本，
> 所以这条命令**不编译任何东西**，不会触发 pnpm 的 `allowBuilds` 构建授权。
> （等包发布到 npm 之后，也可以写成 `dsh plugin --profile web add dsh-boot-animation`。）

装完**必须重启一次 DSH 服务**才生效（bundle 层是在启动时装配的）：

```sh
# 停掉当前的 dsh web，然后
dsh web
```

### 装完看不到效果？先做这件事

DSH 的客户端 bundle 响应带 `cache-control: max-age=31536000, immutable`，
而 URL 上的 `rev` 是**进程 nonce**、不会随内容变化。所以浏览器会一直用**第一次抓到的副本**。

装好或升级后请在新窗口里按 **Ctrl+Shift+R（硬刷新）**。普通 F5 不够。

## 用法

### 新对话自动播

打开一个还没说过话的新对话时会自动播一次。

### 让某个会话每次打开都播（推荐）

1. 打开那个会话
2. 点侧边栏最下面的 **🎞** 图标（就在「设置」旁边）
3. 图标变绿 **🎬** = 已钉住

之后**每次**进入这个会话都会播一遍 —— 切走再切回来、刷新页面，都会重播。

再点一下图标取消。

> 注意：如果刚启动时你的活动主面板不是「对话」（比如停在某个插件的面板上），
> 当前会话还不存在，图钉是禁用状态。先打开一个对话即可。

## 换自己的视频

host 半侧按这个顺序找一个**非空文件**，并且**每次请求都重新解析**（换片子不用重启）：

| 顺序 | 位置 |
|---|---|
| 1 | 环境变量 `DSH_BOOT_ANIMATION` 指向的文件 |
| 2 | `$DSH_HOME/boot-animation/intro.mp4`（默认即 `~/.dsh/boot-animation/intro.mp4`） |
| 3 | 包内默认的 `assets/boot.mp4` |

所以最简单的换法：

```sh
mkdir -p ~/.dsh/boot-animation
cp 我的片子.mp4 ~/.dsh/boot-animation/intro.mp4
```

想确认当前用的是哪一个，直接访问状态端点：

```sh
curl http://127.0.0.1:3080/dsh-boot-animation/status.json
```

```json
{ "active": { "kind": "dsh-home", "bytes": 12345678 },
  "candidates": [ { "kind": "dsh-home", "exists": true, "bytes": 12345678 },
                  { "kind": "bundled", "exists": true, "bytes": 3252011 } ] }
```

## 浏览器的两条硬性策略

自动播放**带声音**、以及 Fullscreen API，**都要求用户手势**，任何网页都绕不过。所以：

1. 动画以**静音**在铺满窗口的覆盖层里自动开始（视觉上已经是全屏）
2. **点一下画面**：同时开启声音并进入**真全屏**
3. 万一连静音自动播放也被拒，会显示「点击播放」而不是黑屏

## 排错

| 现象 | 原因 / 处理 |
|---|---|
| 完全没出现 | 十有八九是缓存：**Ctrl+Shift+R**。或重启一次 DSH 服务 |
| 新对话不播 | 这个会话已经播过了（每个会话只播一次）。钉住它可变成每次都播 |
| 钉住了也不播 | 确认图钉是绿色；确认打开的就是被钉的那个会话 |
| 黑屏无画面 | 访问 `/dsh-boot-animation/status.json` 看有没有找到片源；再看浏览器控制台有没有解码错误 |
| 想看到插件在干什么 | 把 `src/client/index.ts` 顶部的 `DEBUG` 改成 `true` 重新构建，控制台会打印每次决策 |

## 实现速记（给维护者）

- 挂载点：`shell.overlay`（帧级浮动层，`kind: list`，新增一格不顶替官方 UI）+
  `sidebar.footer.action`（页脚那个图钉）
- 当前会话来自 `ctx.uiSession.adapter.current` 这个 React 友好的 store。
  **它的快照不是会话记录**，而是解析后的描述符产物
  `{ key, hooks, keyedHooks, props }` —— 会话 id 在 `props.sessionId`，会话快照在 `hooks.session`
- 「这是个全新对话」的字段是 **`blankBit`**（`hooks.session.blankBit`）。
  `session.blank` 属于别的包的投影对象，不在这个快照上
- 「每次点开都播」实现为**监听进入会话**这个动作，而不是记"播过没有"，
  所以被钉的会话不受"已看过"记录限制
- 视频路由支持 **Range**（浏览器对媒体会发 Range；该给 206 却给 200 时有些播放器会拒绝播放）

## 许可

BSD-3-Clause，见 [LICENSE](LICENSE)。包内的 `assets/boot.mp4` 以相同条款分发。
