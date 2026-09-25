# 发布现状与投稿清单

**结论：代码侧全部就绪。剩下两件事——① 在 GitHub 上把仓库改名为 `dsh-boot-animation`（1 次点击），
② 提交市场条目 PR。**

插件市场不是本项目，而是一个由数据文件生成的大仓库：

- 市场前端读的注册表：`https://awesome-dsh-plugin.com/plugins.json`（当前 **4323** 条）
- 数据源仓库：`https://github.com/awesome-dsh-plugin/awesome-dsh-plugin`
- **一次投稿 = 往那个仓库加一个文件**：`data/plugins/NativeDog1__dsh-boot-animation.yml`

文件名不是随便起的，它由 url 推导：`owner/repo` → `owner__repo`。
本插件即 `NativeDog1` + `dsh-boot-animation` → `NativeDog1__dsh-boot-animation.yml`。

要提交的内容已经放在本仓库里，原样复制即可：

```
submission/data/plugins/NativeDog1__dsh-boot-animation.yml
```

---

## 一、四道自动闸门（已逐条对本仓库核对）

闸门脚本在数据源仓库里：`scripts/check-submission.mjs`。它只查这四件事：

| # | 要求 | 本仓库状态 |
|---|---|---|
| 1 | 仓库内**任意** `package.json` 声明 `dsh.bundle` | ✅ 远端已是 `{"patch":"./cordis.patch.yml"}` |
| 2 | 仓库创建**满 1 天**（≥ 24h） | ⏳ 创建于 `2026-09-25T09:40:45Z`，将于**本地 2026-09-26 17:40** 自动转绿 |
| 3 | 仓库存在、未归档、非 fork | ✅ 公开、未归档、非 fork |
| 4 | 不是 DSH 本体 | ✅ |

### 关于闸门 2：它自己会重跑，不用等

脚本里第 2 条失败时的原文是：

> `repository is X days old (needs 1) — nothing to do: this check re-runs by itself and should clear in about Xh. No need to resubmit, push, or close and reopen; the age bar is the only thing failing here.`

所以**今天就能开 PR**：它会红一下，然后自己变绿，不需要重新提交、重新推送、也不需要关掉重开。

### 闸门 1 是真正的杀手，也是最容易踩的

`check-submission.mjs` 里针对它的报错文案：

> `declares only \`dsh.client\` — that alone is not installable`

也就是说：**只声明 `dsh.client` 的插件会被直接拒掉**（投稿指南称这是最常见的被拒原因）。
本仓库同时声明了 `dsh.bundle` 和 `dsh.client`，且 `cordis.patch.yml` 已交给 DSH 组装器验证过（`--patch` → `exit=0`）。

未被闸门检查、但建议顺手做：给 GitHub 仓库加上 **`dsh-plugin`** topic
（Settings → General → Topics），方便维护者与其他人按 topic 发现。

---

## 二、为什么**不需要**发 npm

投稿指南允许两种形态，本仓库走的是「能从源码装」那一种，因此 npm 不是必需：

- 构建产物 `lib/` **已经提交进仓库**：`main` → `./lib/index.js`，`exports["./client"]` → `./lib/client.js`
- `package.json` **没有** `prepare` / `postinstall` 之类的生命周期脚本

两条合起来意味着，别人执行

```sh
dsh plugin add github:NativeDog1/dsh-boot-animation
```

时**不触发任何编译**，也就**不会撞上 pnpm 的 `allowBuilds` 构建授权**——这是从源码安装最常见的失败点。

> 这一点是**实测过**的，不是推断：`npm pack github:NativeDog1/...` 成功解析 git spec、
> 克隆并打出 **11 个文件 / 3.3 MB** 的 tarball，含 `lib/client.js`、`lib/index.js`、
> `cordis.patch.yml`、`assets/boot.mp4`，全程没有跑任何构建脚本。

`tarball:` 字段只在「仓库根本无法从源码安装」时才是必需的，本仓库不是这种情况。

> 可选增强（不是必需）：发 npm，或把预构建 tgz 挂到 GitHub Release 再用 `tarball:` 指向它，
> 市场会展示预构建安装命令。收益是安装更确定、升级更规范。

---

## 三、现在要做的

### 步骤 0（先做）— 把仓库改名

仓库当前叫 `https://github.com/NativeDog1/-`（一个减号）。**必须改成 `dsh-boot-animation`**，
因为市场条目的 `url` 会被闸门持续复查，条目一旦上架再改名就会失效并被摘掉。

> GitHub → 仓库 → **Settings** → General → **Repository name** 填 `dsh-boot-animation` → **Rename**

改完地址是 `https://github.com/NativeDog1/dsh-boot-animation`。
本仓库里 `package.json` 的 `repository` / `homepage` / `bugs`、两个 README 的安装命令、
`submission/` 的条目内容与文件名**都已经按新名字改好了**，改名后全部自动对上。

（GitHub 会为旧地址保留重定向，所以本地 `git remote` 即使还写着旧名字也照样能推。）

### 步骤 1 — 提交市场条目

**方式 A — 网页，约 1 分钟，不需要命令行**

1. 打开 <https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/fork> → **Create fork**
2. 在你自己那份 fork 里：**Add file** → **Create new file**
3. 文件名填：`data/plugins/NativeDog1__dsh-boot-animation.yml`
4. 内容粘贴下面这段（与 `submission/` 里那份完全一致）：

```yaml
url: https://github.com/NativeDog1/dsh-boot-animation
name: NativeDog1/dsh-boot-animation
category: ui
description:
  en: 'Plays a full-frame intro video when a new conversation starts, or every time you open the conversation you pinned — a real 720p clip with a pin button beside Settings, replaceable with your own file via DSH_BOOT_ANIMATION or the DSH home directory.'
  zh: '打开新对话时、以及每次打开你钉住的那个会话时，铺满整个窗口播放一段片头视频——真实 720p 片源，设置旁一键钉住会话，可用 DSH_BOOT_ANIMATION 或 DSH 主目录放入自己的影片替换。'
```

5. **Commit changes** → 回到 fork 首页，点 **Contribute** → **Open pull request**
6. 标题随意，例如 `Add NativeDog1/dsh-boot-animation`

> ⚠️ 只交这一个 `.yml`。**不要手工改 `README.md` / `README.zh.md`** ——
> 它们由 `data/plugins/*.yml` 生成，合并后会在 `main` 上自动重新生成。
> 只交 yml 也是最不容易和别人冲突的路径（生成出来的 README 行永远会互相冲突，条目文件不会）。

**方式 B — 用 git**

```sh
git clone https://github.com/<你的用户名>/awesome-dsh-plugin.git
cd awesome-dsh-plugin
cp <本项目>/submission/data/plugins/NativeDog1__dsh-boot-animation.yml data/plugins/
git add data/plugins/NativeDog1__dsh-boot-animation.yml
git commit -m "Add NativeDog1/dsh-boot-animation"
git push
```

然后在 GitHub 上点 Compare & pull request。

### 步骤 2 — 等它转绿

PR 上的年龄闸门现在会红。本地时间 **2026-09-26 17:40** 之后它自己重跑、自己变绿，
维护者合并后市场就会收录（市场每次打开都实时拉取注册表，通常一天内生效）。

---

## 四、提交市场条目的字段规则（这些坑都踩过）

来自 `scripts/lib/entries.mjs` 的 `validateEntries()` —— 本地已用**真校验器**跑过，
`NativeDog1__dsh-boot-animation.yml` 结果是**零问题**。

- **只允许 6 个键**：`url` / `name` / `category` / `description` / `tarball` / `file`（`file` 由脚本加）。
  **多一个键就判不合格。** 特别是 `npm:` 是**禁止**的——npm 包由脚本从仓库自动解析
  （`data/npm-map.json` 由 `probe-npm.mjs` 在校验「包的 repository 是否指回本仓库」后写入）。
  曾经有 4 个条目带了 `npm:` 键，后来被清理。
- 文件名必须**恰好等于** `owner__repo`，且必须位于 `data/plugins/`、**恰好一层**
  （写成 `data/<owner>__<repo>.yml` 或 `data/plugins/data/plugins/...` 都会被静默忽略：
  不报错、README 也不生成、合并了却什么都没发生）。
- `name` 若写成 `owner/repo` 形式，**必须与 url 指向同一个仓库**（链接文字不能与目标不符）。
- `description.en` **必填**、必须**单行**、必须以英文句号结尾。
- `description.zh` **可选**——缺了维护者会补，不作为打回理由。
- 描述中出现 `: `（英文冒号+空格）**必须加引号**，否则 YAML 会把它当成嵌套键。
- `category` 只能取白名单 23 个之一。
- 一个 PR 最多加 3 条。

### 分类选 `ui` 的依据

白名单里同时有 `ui`（737 条）和 `fun`（128 条）。查了 `fun` 的实际内容——
里面是宠物、桌宠、游戏、股票看板这类，**不是动画**；而既有的启动动画 / splash 插件
**全部都在 `ui`**，所以本插件归 `ui`。

---

## 五、同类插件现状（先看清楚再写描述）

数据源里已经有 4 个同类插件，全部是 `ui` 分类：

| 插件 | 做法 |
|---|---|
| `KylinQ01/dsh-startup-animation` | 程序化启动动画（头像 + 极光 + 星尘 + 指针视差 + 模块组装入场），兼作主界面壁纸 |
| `yanglingrise/dsh-erii-boot-splash` | 主题化 splash（樱花飘落 + 吉祥物 + 进度条），约 3 秒淡出 |
| `Isilsolme/dsh-splash-launcher` | Windows 无边框 WPF 启动器动画（HARNESS 逐笔描边） |
| `LeemanCheung/dsh-whale-animation` | 回合状态旁的 60 帧鲸鱼深潜动画 |

**本插件的差异点（写进了市场描述）：**

1. **播放真实视频**，不是 CSS/Canvas 程序化绘制——1280×720、7 秒的真实片源，经 HTTP Range 分发
2. **「钉住某个会话，每次打开都重播」**——上面 4 个都没有这个能力
3. **片源可替换**：`DSH_BOOT_ANIMATION` → `$DSH_HOME/boot-animation/intro.mp4` → 包内默认，三级查找、每次请求重新解析

---

## 六、关于提交身份

提交作者是 `NativeDog1 <332947228+NativeDog1@users.noreply.github.com>`。

你没有提供真实邮箱，所以用了 GitHub 官方隐私邮箱（新账号的正确格式就是 `ID+用户名@…`），
这样不会把真实邮箱写进公开历史。**现在换还很便宜**：

```sh
cd C:\Users\高振杰\dsh-dev\dsh-boot-animation
git config user.email "你的真实邮箱"
git commit --amend --reset-author --no-edit
git push --force
```

---

## 七、市场为什么必须在「精选列表」里

你界面里的插件市场是 `dshmarket`（v1.55.0）。它自己的 README 写得很明确：

> **本仓库是市场应用，不是插件目录。** 插件列表来自精选列表
> [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)——
> 想让你的插件上架，请去**那边**提 PR（在列表里加一条即可，站点和本市场会自动收录，通常一天内生效）。

> 每次打开都实时请求 `awesome-dsh-plugin.com/plugins.json`……精选条目、npm 映射、star 数由 CI 每日刷新，
> **不使用过期缓存兜底**。

> 只允许安装**精选列表内**的来源，其它一律拒绝。

所以因果关系是：**PR 被合并 → 列表 `main` 更新 → CI 重新生成 `plugins.json` → 市场里就能搜到、并且能一键安装。**
换句话说，被这个列表收录**正是**「市场里一键安装」的前置条件。

---

## 八、发布后自测（很重要）

**换一个干净的 profile**，按文档那样装一次：

```sh
dsh --profile smoketest --from-default-profile web
dsh plugin --profile smoketest add github:NativeDog1/dsh-boot-animation
```

启动后**硬刷新（Ctrl+Shift+R）**，确认侧边栏页脚出现 🎞 片头动画按钮。

这一步验证的正是本地测不到的东西：**bundle patch 是否真的把插件挂进了层栈**。
本地一直是用注入器直接塞 loader entry 的，走的是另一条路。

---

## 九、版本迭代

改完客户端 bundle 请**同时升版本号**：

```sh
npm version patch   # 或 minor / major
git push --follow-tags
```

因为 bundle 的 URL `rev` 是进程 nonce、不随内容变化，
**用户升级后必须重启 DSH 服务 + 硬刷新**才能看到新版 —— README 里已写明这条。
