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

## 换自己的视频（片库）

插件现在是一个**片库**，不是单个槽位：它会把所有能找到的视频都列出来，你选一个，选择会被记住。

### 最省事的方式（推荐）

1. 把 mp4 丢进 `~/.dsh/boot-animation/videos/`
2. 在侧边栏页脚点 **🎛**（在 🎞 图钉旁边）打开「片头片库」
3. 点一下你想播的那一条

选中的那段会在**下一次**播放片头时登场：新对话、以及你钉住的会话。

> Windows 上就是 `C:\Users\<你>\.dsh\boot-animation\videos\`
> 具体路径以片库面板底部显示的那一行为准。

### 片库面板

| 元素 | 作用 |
|---|---|
| ✓ 标记 | 当前生效的那一条 |
| 来源徽章 | `你自己加的` / `插件自带` / `内置原始` / `环境变量` |
| 文件大小 | 帮你确认换对了没有 |
| 刷新 | 刚往文件夹里丢完文件，点它重新扫描 |
| `原片源` 徽章 | 历史上那个 `intro.mp4` 落点，仍然优先 |
| ⚠ 未优化 徽章 | 该文件的索引表 `moov` 在末尾，建议重排（见下） |
| `铺满屏幕` / `完整显示` | 播放时怎么贴合窗口，见下 |

### 播放时怎么贴合窗口（黑边问题）

覆盖层铺满整个窗口，但**窗口的长宽比几乎不会是视频的长宽比**——浏览器有标题栏和
工具栏，可视区通常比 16:9 更宽。这时：

| 模式 | CSS | 效果 |
|---|---|---|
| **铺满屏幕**（默认） | `object-fit: cover` | 填满窗口，**没有黑边**，超出部分被裁掉 |
| 完整显示 | `object-fit: contain` | 整帧都在，长宽比不匹配时**留黑边** |

在片库面板里切换，**下次播放生效**。选「完整显示」的情况：片子里有贴着边缘的字幕、
logo 或水印，不想被裁掉。

> 如果黑边来自**视频本身烧进去的边框**（导出时带上的），改 CSS 没用，要用
> ffmpeg 裁掉：`ffmpeg -i in.mp4 -vf "crop=W:H:X:Y" -c:a copy out.mp4`。
> 判断方法：`ffmpeg -v info -i in.mp4 -vf cropdetect=24:16:0 -f null -`，
> 若 `crop=` 值全程稳定，就是烧进去的；若随画面变化，那只是深色背景，别裁。

### 支持的格式

`.mp4` `.m4v` `.webm` `.mov` `.mkv` —— 但**能不能播取决于浏览器解码**。
H.264 + AAC 的 mp4 最稳；HEVC(H.265)、ProRes、部分 mkv 大概率只有声或黑屏。

### 手动方式（老办法，仍然有效）

host 半侧按这个顺序解析，**每次请求都重新解析**（换片子不用重启）：

| 顺序 | 位置 |
|---|---|
| 1 | `~/.dsh/boot-animation/selection.json` 里选中的那个 id（片库面板写的） |
| 2 | 环境变量 `DSH_BOOT_ANIMATION` 指向的文件 |
| 3 | `~/.dsh/boot-animation/intro.mp4`（历史落点，仍优先于片库里的其他文件） |
| 4 | `~/.dsh/boot-animation/videos/` 里最新修改的那个 |
| 5 | 包内 `videos/` 里最新修改的那个 |
| 6 | 包内默认的 `assets/boot.mp4` |

所以最保险的手动换法依然是：

```sh
mkdir -p ~/.dsh/boot-animation
cp 我的片子.mp4 ~/.dsh/boot-animation/intro.mp4
```

想确认当前用的是哪一个，直接访问状态端点：

```sh
curl http://127.0.0.1:3080/dsh-boot-animation/status.json
curl http://127.0.0.1:3080/dsh-boot-animation/videos.json
```

### 排错：视频是黑的 / 放着放着没了

**多半是容器没做 faststart。** 如果 mp4 的索引表 `moov` 在文件末尾，浏览器必须
**整段下完**才能解码，中间一直黑屏；而客户端有 **25 秒看门狗**（`STALL_TIMEOUT_MS`），
超时就自己把覆盖层关掉 —— 症状就是「点开什么都没有」。

用 ffmpeg 重排一下容器（**无损**，不重新编码）：

```sh
ffmpeg -i 原片.mp4 -c copy -movflags +faststart 修好的.mp4
```

验证 moov 是否前置：

```sh
ffprobe -v trace 修好的.mp4 2>&1 | grep -m1 moov   # 偏移应该很小
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
| 黑屏无画面 | 先看 moov 是否前置（见上「排错：视频是黑的」）；再访问 `/dsh-boot-animation/status.json` 看片源；最后看浏览器控制台有没有解码错误 |
| 换了片没生效 | 片库里点完要有 ✓ 才生效；确认文件在 `videos/` 里并点了「刷新」 |
| 播到一半自己没了 | 25 秒看门狗（`STALL_TIMEOUT_MS`）超时 —— 通常还是 faststart 或解码太慢 |
| 想看到插件在干什么 | 把 `src/client/index.ts` 顶部的 `DEBUG` 改成 `true` 重新构建，控制台会打印每次决策 |

## 实现速记（给维护者）

- 挂载点：`shell.overlay`（帧级浮动层，`kind: list`，新增一格不顶替官方 UI）+
  `sidebar.footer.action`（页脚那个图钉和 🎛 片库入口）
- 当前会话来自 `ctx.uiSession.adapter.current` 这个 React 友好的 store。
  **它的快照不是会话记录**，而是解析后的描述符产物
  `{ key, hooks, keyedHooks, props }` —— 会话 id 在 `props.sessionId`，会话快照在 `hooks.session`
- 「这是个全新对话」的字段是 **`blankBit`**（`hooks.session.blankBit`）。
  `session.blank` 属于别的包的投影对象，不在这个快照上
- 「每次点开都播」实现为**监听进入会话**这个动作，而不是记"播过没有"，
  所以被钉的会话不受"已看过"记录限制
- 视频路由支持 **Range**（浏览器对媒体会发 Range；该给 206 却给 200 时有些播放器会拒绝播放）
- **hook 只能在组件里调**：`apply()` 是插件加载器调的，不是 React 调的，所以状态
  全部住在 `AppRoot` 组件内。片库入口在图钉那个 slot、对话框在 overlay 那个 slot，
  是两个独立的 React 根，用模块级 `libraryOpeners` 订阅集合桥接
- 片库的路由：`videos.json`（列）、`media/<id>`（按 id 流）、`select`（POST 写选择）、
  `boot.mp4`（老路由，服务当前生效的那条，向后兼容）
- `assets/boot.mp4` 的只读属性会让 ffmpeg/覆盖写入报 `Permission denied`：
  `Set-ItemProperty -Name IsReadOnly -Value $false`
- **prefix 路由不能带尾部斜杠**：webserver 用
  `pathname !== prefix && !pathname.startsWith(prefix + '/')` 匹配，注册
  `.../media/` 会被当成 `.../media//`，永远匹配不上（曾导致 /media/<id> 全 404）

## 验证脚本（改完跑一遍）

| 命令 | 作用 |
|---|---|
| `npm run verify:routes` | 用**服务器自己的匹配规则**驱动真实 handler，断言每条路由 |
| `npm run verify:letterbox` | 用 CDP 驱动本机 Edge，量出所选贴合方式实际留多少黑边 |
| `npm run check` | 上面两个 + CSS 模板反引号检查 |
| `npm run build:client` | 先跑 CSS 检查再构建（防带病构建） |

两个脚本都是被真实 bug 逼出来的，各自都有过一次"用自己的规则测自己"的教训：
它们的断言刻意复刻被测方的规则，并且在提交前会做**反向验证**（故意改坏 → 必须报错）。

> 客户端构建有一个坑：整个 CSS 是一段模板字符串，注释里写一个反引号就会提前把它
> 结束掉，而报错是 **TypeScript 的 parse error 指向某行 CSS**，同时 `lib/client.js`
> 保持不变 —— 看起来像改成功了其实没生效。`scripts/check-css-template.mjs` 专门
> 拦这个，已接进 `build:client`。

## 许可

BSD-3-Clause，见 [LICENSE](LICENSE)。包内的 `assets/boot.mp4` 与 `videos/` 下的
默认片源以相同条款分发。
