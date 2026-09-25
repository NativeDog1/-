# 发布清单

代码侧**已经全部准备好并已提交**（作者 `NativeDog1`）。剩下需要账号的几步我做不了：
这台机器没有 `gh` CLI、npm 也没登录、git 全局身份为空。

## 已完成

- [x] 包名 `dsh-boot-animation`（npm 上未被占用）
- [x] **补上 `cordis.patch.yml` 与 `dsh.bundle.patch`** —— 最关键的一条，
      没有它别人 `dsh plugin add` 会装成一个"什么都不发生的普通依赖"
- [x] `dsh.engines.dsh: ">=0.1.5-rc.1"` —— 插件市场靠它过滤兼容性
- [x] `dsh.client.inject` 声明了依赖的客户端插件（slots / session / layout / sidebar）
- [x] 去掉 `private`，版本 `0.1.0`，补齐 `files` / `keywords` / `license` / `author` /
      `repository` / `homepage` / `bugs`
- [x] 视频可替换：`DSH_BOOT_ANIMATION` → `$DSH_HOME/boot-animation/intro.mp4` → 包内默认
- [x] `status.json` 诊断端点
- [x] LICENSE、中英双语 README
- [x] `npm pack --dry-run` 验证：11 个文件、3.3 MB、含 `cordis.patch.yml`
- [x] `cordis.patch.yml` 用 `--patch` 喂给 DSH 组装器验证过：`exit=0`，insert 行正确落树
- [x] git 仓库已初始化并完成首次提交

## 你要做的

### 1. 先把仓库改名（重要）

你已经建了仓库，但**名字是一个减号**：`github.com/NativeDog1/-`。
仓库是空的，改名零成本：

> GitHub → 那个仓库 → **Settings** → General → **Repository name** 改成 `dsh-boot-animation` → Rename

改完地址就是 `https://github.com/NativeDog1/dsh-boot-animation`，
与 `package.json` 里已填好的完全一致。

### 2. 推上去

```sh
cd C:\Users\高振杰\dsh-dev\dsh-boot-animation

git remote add origin https://github.com/NativeDog1/dsh-boot-animation.git
git push -u origin main
```

> 仓库内容与 npm 包内容**不一样**：仓库里有 `src/` 与 `scripts/`（源码 + 验证脚本），
> npm 包按 `package.json` 的 `files` 只发 `lib/`、`assets/`、`cordis.patch.yml`、README、LICENSE。
> 这是这个生态的惯例：GitHub 放源码，npm 放产物。

### 3. 登录 npm 并发布

```sh
npm login
npm publish
```

包名无 scope，`npm publish` 默认就是公开的。

### 4. 提交插件市场条目

社区注册表（`community.json`，当前 85 条）的条目，直接照抄：

```json
{
  "id": "dsh-boot-animation",
  "name": "开机动画",
  "nameEn": "Boot Animation",
  "author": "NativeDog1",
  "description": "打开新对话、或打开你钉住的会话时，视频铺满整个窗口播放一段片头开机动画。支持换成自己的视频，每个会话只播一次或每次打开都播。",
  "descriptionEn": "Plays a full-frame intro animation when you open a new DSH conversation, or any conversation you pin. Bring your own video; play once per conversation or on every open.",
  "repo": "https://github.com/NativeDog1/dsh-boot-animation",
  "npm": "dsh-boot-animation",
  "category": "ui",
  "subcategory": "panel"
}
```

注册表上游仓库以插件市场里的「社区插件」数据源为准
（本机缓存数据在 `~/.dsh/profiles/web/node_modules/@linxin666/dsh-client-ui-community-plugins/community.json`），
按它的贡献流程提 PR。

## 关于提交身份

提交作者是 `NativeDog1 <332947228+NativeDog1@users.noreply.github.com>`。

你没给真实邮箱，所以我用了 GitHub 官方隐私邮箱（新账号的正确格式就是 `ID+用户名@…`），
这样不会把你的真实邮箱写进公开历史。**提交还没推送，现在换很便宜**：

```sh
cd C:\Users\高振杰\dsh-dev\dsh-boot-animation
git config user.email "你的真实邮箱"
git commit --amend --reset-author --no-edit
```

## 发布后自测（很重要）

**换一台干净机器、或新建一个 profile**，按文档那样装一次：

```sh
dsh --profile smoketest --from-default-profile web
dsh plugin --profile smoketest add dsh-boot-animation
```

启动后**硬刷新（Ctrl+Shift+R）**，确认侧边栏页脚出现 🎞。

这一步验证的正是本地测不到的东西：**bundle patch 是否真的把插件挂进了层栈**。
本地一直是用注入器直接塞 loader entry 的，走的是另一条路。

## 版本迭代

改完客户端 bundle 请**同时升版本号**：

```sh
npm version patch   # 或 minor / major
npm publish
```

因为 bundle 的 URL `rev` 是进程 nonce、不随内容变化，
**用户升级后必须重启 DSH 服务 + 硬刷新**才能看到新版 —— README 里已写明。
