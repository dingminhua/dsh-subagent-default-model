# 发布流程（Release Flow）

> 本文档是 `dsh-subagent-default-model` 的**唯一权威发布流程**。发布前请通读一遍。

## 前置条件

- npm 已登录：`npm whoami` 应显示 `dmh2002`（若报 `need auth`，先 `npm login`）
- 账号若开启 2FA（两步验证）：`npm publish` 时需**在浏览器确认一步**（见下文 2FA 说明）
- GitHub 仓库：`https://github.com/dingminhua/dsh-subagent-default-model`（默认分支 `main`）
- 网络：本机已配置代理 `127.0.0.1:7897`（git 与 npm 均已配置，用于访问 GitHub / npm registry；若在其他机器发布，直连即可）

## 每次发布的完整步骤

### 1. 确认代码与测试

```bash
cd /Users/dmh2002/DshProject/dsh-subagent-default-model
npm --prefix plugin test        # 单元测试，应 8/8 通过
```

### 2. 更新版本号

```bash
# 手动改 plugin/package.json 的 version 字段，或：
npm --prefix plugin version patch|minor|major --no-git-tag-version
```

> 后续步骤以目标版本号 `X.Y.Z` 指代。

### 3. 更新 CHANGELOG.md

在 `plugin/CHANGELOG.md` 顶部新增一节 `## X.Y.Z (YYYY-MM-DD)`，按 `Features` / `Fixes` / `Docs` 分组记录本次变更（参见现有 0.3.1 的写法）。

### 4. 提交并打 git tag

```bash
git add plugin/package.json plugin/CHANGELOG.md
git commit -m "chore: 版本升级至 X.Y.Z"
git tag -a vX.Y.Z -m "vX.Y.Z: <一句话说明>"
git push origin main
git push origin vX.Y.Z
```

> ⚠️ **tag 必须指向包含本次代码的提交**。若目标 tag 已存在且指向旧提交（如曾误打），需先删除并强制移动：
> ```bash
> git tag -d vX.Y.Z
> git tag -a vX.Y.Z -m "vX.Y.Z: <说明>"
> git push -f origin vX.Y.Z
> ```
> 修正后务必用 `git rev-list -n1 vX.Y.Z` 确认指向当前 HEAD。

### 5. 发布到 npm

```bash
cd plugin
npm publish
```

**打包内容**：`package.json` 的 `files` 字段已限定只发布 `lib/`、`cordis.patch.yml`、`LICENSE`、`README.md`、`README.en.md`、`CHANGELOG.md`，`test/` 和 `node_modules/` 不会进入发布包。

**发布前检查**（可选但推荐）：

```bash
npm pack --dry-run    # 核对 tarball 内容与版本号
```

### 6. 2FA 确认（若账号开启两步验证）

`npm publish` 会打印类似：

```text
npm error code EOTP
npm error Open this URL in your browser to authenticate:
npm error   https://www.npmjs.com/auth/cli/<id>
```

- **在终端能看到完整链接**（本机 npm CLI 展示的 URL 未打码）。用浏览器打开，登录确认。
- 建议**勾选** "Do not challenge npm publish, npm trust operations from IP address ... for the next 5 minutes"，可避免 5 分钟内重复验证。
- 点击 "Use security key"（或相应确认按钮）完成验证，终端内的 `npm publish` 会自动继续。

> ⚠️ npm 从 2026 年起正在收紧「2FA-bypass 访问令牌」的直接发布能力（见 [npm changelog](https://github.blog/changelog/2026-07-08-npm-install-time-security-and-gat-bypass2fa-deprecation/)）。**交互式 2FA 发布始终受支持**，是首次发布最稳妥的方式。

### 7. 验证发布成功

```bash
npm view dsh-subagent-default-model version        # 应显示 X.Y.Z
npm view dsh-subagent-default-model dist-tags.latest   # 应为 X.Y.Z
```

> 注意：刚发布后 registry 读缓存可能有短暂延迟，可能出现 `version` 返回旧版、`versions` 却含新版的情况。稍等重查即可。

## 完整示例（以 0.3.1 为准）

```bash
# 1. 测试
npm --prefix plugin test

# 2. 版本 0.3.1 → 0.3.1（本例已改）
# 3. CHANGELOG 加 ## 0.3.1 (2026-08-24) 记录 README 双语更新
# 4. 提交 + tag
git add plugin/package.json plugin/CHANGELOG.md
git commit -m "chore: 版本升级至 0.3.1（README 双语 + CHANGELOG）"
git tag -a v0.3.1 -m "v0.3.1: README 中英双语双文件（npm @0.3.1）"
git push origin main
git push origin v0.3.1

# 5. 发布（走 2FA 确认）
cd plugin && npm publish

# 6. 验证
cd .. && npm view dsh-subagent-default-model version  # → 0.3.1
```

## 常见问题

### `npm publish` 报 EOTP（需要一次性密码）

账号开启了 2FA。按上文第 6 步在浏览器确认即可。**不要在 npm auth 页面之外绕过 2FA**。

### 发布后 `npm view ... version` 还是旧版本

registry 缓存延迟。等几秒后重查 `npm view ... versions`，若含新版本且 `dist-tags.latest` 正确即为成功。

### 想用 token 自动发布（不每次点 2FA）

可生成 granular access token（选 publish 权限）。但注意 npm 正在限制 2FA-bypass token 直接发布，**建议优先交互式 2FA 发布**；自动化发布可评估 [trusted publishing (OIDC)](https://docs.npmjs.com/trusted-publishing)。

### 本地开发与发布的关系

本地开发用 `link:` 安装（`dsh plugin --profile desktop add /path/plugin`），与 npm 发布互不影响。npm 发布的包是 `lib/`、README 等静态文件，同一份源码。
