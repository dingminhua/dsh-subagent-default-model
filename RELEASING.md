# 发布流程（Release Flow）

> 本文档是 `dsh-subagent-default-model` 的**唯一权威发布流程**。发布前请通读一遍。

## 前置条件

- npm 已登录：`npm whoami` 应显示 `dmh2002`（若报 `need auth`，先 `npm login`）
- 账号若开启 2FA（两步验证）：`npm publish` 时需**在浏览器确认一步**（见下文 2FA 说明）
- GitHub 仓库：`https://github.com/dingminhua/dsh-subagent-default-model`（默认分支 `main`）
- **`gh` CLI 已登录**：`gh auth status` 应显示 `Logged in to github.com account dingminhua`（第 8 步创建 GitHub Release 需要；未装/未登录时可用网页版替代，见该步说明）
- 网络：本机已配置代理 `127.0.0.1:7897`（git 与 npm 均已配置，用于访问 GitHub / npm registry；若在其他机器发布，直连即可）

> ⚠️ **本机 `npm` / `gh` 不在默认登录 PATH 上**（`/etc/paths` 不含 `/opt/homebrew/bin`，`bash -lc 'command -v npm'` 为空）。在脚本或非交互 shell 里调用时需显式带上：
> ```bash
> export PATH="/opt/homebrew/bin:$PATH"
> ```

## 每次发布的完整步骤

### 1. 确认代码与测试

```bash
cd /Users/dmh2002/DshProject/dsh-subagent-default-model   # macOS / Linux
# Windows: cd C:\Users\<你>\DshProject\dsh-subagent-default-model
npm --prefix plugin test        # 单元测试，必须 0 fail 且 pass 数与 tests 数相等
```

> 这里刻意不写死用例数：它会随每次改动漂移（本项目已从 92 → 112 → 116 → 120），
> 写死后每次都得跟着改，且容易漏改。判定标准是 `node --test` 汇总里的
> **`fail 0`**，以及 **`pass` 等于 `tests`**（有 `skipped`/`todo` 时另计）。

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

**打包内容**：`package.json` 的 `files` 字段已限定只发布 `lib/`、`icons/`、`cordis.patch.yml`、`LICENSE`、`README.md`、`README.en.md`、`CHANGELOG.md`，`test/` 和 `node_modules/` 不会进入发布包。

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

> **注意：刚发布后 registry 读缓存可能有短暂延迟**，可能出现 `version` 返回旧版、`versions` 却含新版的情况。稍等重查即可。
>
> ⚠️ **不要用单次查询的结果判定「发布失败」**。判定「未发布」必须同时满足以下三条，缺一不可：
>
> 1. `npm view <pkg> versions` **不含**目标版本；
> 2. 直连 registry（绕开 npm 本地缓存）也不含目标版本：
>    ```bash
>    curl -s "https://registry.npmjs.org/<pkg>" -H 'Cache-Control: no-cache' \
>      | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['dist-tags'], '1.2.3' in d['versions'])"
>    ```
> 3. 且**已等待数分钟**后复查仍是同样结果。
>
> 只凭一条 `npm view ... version` 输出旧版就重做版本号，是本项目**实际踩过的坑**（见下文 E409 条目）：发布其实早已成功，误判后多打了一个版本、多推了一个 tag，事后还需 revert 回滚。

### 8. 创建 GitHub Release

**这一步很容易漏**（历史上有版本就漏过，见下方「覆盖率」）。它位于 npm 发布**之后**，因为 Release 正文要引用已发布的版本号；而它与 npm 发布**互相独立**——npm 成功不代表 Release 已建，反之亦然。

```bash
export PATH="/opt/homebrew/bin:$PATH"   # 本机 gh 不在默认 PATH 上
cd /Users/dmh2002/DshProject/dsh-subagent-default-model

gh release create vX.Y.Z \
  --repo dingminhua/dsh-subagent-default-model \
  --title "vX.Y.Z — <一句话卖点>" \
  --notes-file /tmp/rel-body.md \
  --verify-tag
```

- `--verify-tag`：tag 不在远端时**直接报错**，避免建出一个指向不存在 tag 的 Release。
- `--notes-file`：正文从文件读，避免多行 Markdown 在 shell 里被转义搞坏。
- **不要加** `--draft` / `--prerelease`：本项目发布正式版本。

**标题格式**（沿用既有惯例）：`vX.Y.Z — <一句话>`
**正文格式**（对照 v2.0.0 / v2.0.1 / v2.0.8 的既有正文）：

```markdown
## <主题：做了什么>

> <一句话摘要 + 升级建议；必要处标注「破坏性变更」>

**根因**：…    （先讲清为什么会坏，再讲怎么修的）
**修法**：…
**验证**：<表格或列表，写实测数据而非估算>

## 安装
（`dsh plugin --profile desktop add <pkg>` 与 `npm install` 两种方式 + 重启提示）

## 测试
（如 `128/128 通过`，注明新增用例数）
```

**验证 Release 真的建成了**（用两种独立途径，不要只看命令退出码）：

```bash
export PATH="/opt/homebrew/bin:$PATH"
gh release view vX.Y.Z --repo dingminhua/dsh-subagent-default-model \
  --json tagName,name,isDraft,isPrerelease,publishedAt

# 独立复核（公开 API，无需鉴权）
curl -s "https://api.github.com/repos/dingminhua/dsh-subagent-default-model/releases?per_page=100" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      for(const r of JSON.parse(s)) console.log(r.tag_name, r.draft?"DRAFT":"", r.name)})'
```

**没装 / 没登录 `gh` 时**：用网页版 <https://github.com/dingminhua/dsh-subagent-default-model/releases/new?tag=vX.Y.Z> 手动创建，正文粘贴同一份 Markdown 即可。

> 📌 **覆盖率提示**：截至 v2.0.8，仓库有 **19 个 tag，但只有 3 个 Release**（`v2.0.0`、`v2.0.1`、`v2.0.8`）——
> 其余 **16 个 tag 都没有对应 Release**（`v0.3.0`…`v1.3.0` 全线、`v2.0.2`、`v2.0.7`）。也就是说，这一步历来容易被跳过，
> **不是**「每个版本都做过」。**从 v2.0.8 起应视为每次发布的必做步骤**；如需补齐历史，用上文脚本逐个查出后
> `gh release create <tag> --verify-tag --title "…" --notes-file …` 补建（npm 包不受影响，无需重发）。

## 完整示例（以 0.3.1 为准）

> 下面按**紧凑编号**（1–7）串一遍端到端流程，与上文「完整步骤」的 1–8 编号**不是一一对应**（2FA 合并在第 5 步内）。
> ⚠️ 第 7 步是 **v2.0.8 起新补入文档**的步骤：0.3.1 当初**并未**创建 Release，此处仅为流程示范。

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

# 6. 验证 npm
cd .. && npm view dsh-subagent-default-model version  # → 0.3.1

# 7. 创建 GitHub Release（v2.0.8 起新增的必做步骤，详见上文「8. 创建 GitHub Release」）
export PATH="/opt/homebrew/bin:$PATH"
gh release create v0.3.1 \
  --repo dingminhua/dsh-subagent-default-model \
  --title "v0.3.1 — README 中英双语" \
  --notes-file /tmp/rel-body.md \
  --verify-tag
```

## 常见问题

### 忘了创建 GitHub Release

**症状**：npm 上版本已发布，但 <https://github.com/dingminhua/dsh-subagent-default-model/releases> 里找不到该版本；`git tag` 有、Release 没有。历史上 `v2.0.2` / `v2.0.7` 就是这样漏掉的。

**为什么容易漏**：npm 发布与 GitHub Release 是**两条互相独立的链路**——`npm publish` 成功不会自动建 Release，而发布流程文档在 v2.0.8 之前只写到「验证 npm 发布成功」就结束了。

**补救**（tag 已存在，直接补建即可，不影响已发布的 npm 包）：

```bash
export PATH="/opt/homebrew/bin:$PATH"
cd /Users/dmh2002/DshProject/dsh-subagent-default-model
gh release create vX.Y.Z \
  --repo dingminhua/dsh-subagent-default-model \
  --title "vX.Y.Z — <一句话>" \
  --notes-file /tmp/rel-body.md \
  --verify-tag
```

正文可参照同版本在 `plugin/CHANGELOG.md` 里的记录来写。

**一次核对全部历史版本是否都有 Release**：

```bash
export PATH="/opt/homebrew/bin:$PATH"
cd /Users/dmh2002/DshProject/dsh-subagent-default-model
for t in $(git tag -l | sort -V); do
  gh release view "$t" --repo dingminhua/dsh-subagent-default-model >/dev/null 2>&1 \
    && echo "  ✅ $t" || echo "  ❌ $t  (缺 Release)"
done
```

### `npm publish` 报 EOTP（需要一次性密码）

账号开启了 2FA。按上文第 6 步在浏览器确认即可。**不要在 npm auth 页面之外绕过 2FA**。

> ⚠️ **不要在确认 2FA 之前放弃或重复执行**。EOTP 中断的那次 publish 可能在服务端留下一个 **staged 版本占位**：版本号被占住，但该版本尚未进入 registry（查询返回 404 / `ResourceNotFound`）。此时任何后续 publish 都会报 E409（见下条），而 registry 上又查不到该版本，状态看起来自相矛盾。
>
> 若确实中断了，**先回到浏览器完成那次的认证**；无法完成时再到 <https://www.npmjs.com/settings/> 的 packages 页面确认是否存在待处理的 staged 版本。

### `npm publish` 报 E409 `Cannot publish over previously staged version "X.Y.Z"`

**这通常不是坏事，而是「该版本其实已经发布成功」的信号。** 完整报错形如：

```text
npm error code E409
npm error 409 Conflict - PUT https://registry.npmjs.org/<pkg>
npm error Cannot publish over previously staged version "X.Y.Z".
```

含义：registry 已存在该版本号（无论是前一次成功发布后转为正式版本，还是仅留下 staged 占位），因此不允许再次写入同一个版本。

**正确处理顺序**（务必先查、再决定，不要急着改版本号）：

```bash
# 1. 直连 registry 绕开缓存，确认该版本到底存不存在
curl -s "https://registry.npmjs.org/dsh-subagent-default-model" -H 'Cache-Control: no-cache' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['dist-tags']); print('1.2.3' in d['versions'])"

# 2. 若确认存在 → 发布已成功，什么都不用做，结束
# 3. 若确认不存在且等待数分钟后仍不存在 → 才是真的卡在 staged，再考虑顺延版本号
```

**真实教训（1.2.3 → 1.2.4 的反复）**：发布 1.2.3 时先遇 EOTP（2FA 未确认），随后在浏览器完成认证发布成功；但验证时赶上 registry 缓存，`npm view ... version` 读到的仍是 `1.2.2`，遂误判为「未发布」，进而把版本顺延到 1.2.4、推了新 tag。事后发现 1.2.3 其实早已是 `latest`，只能 revert 回滚，并删除多余的 `v1.2.4` tag、重建 `v1.2.3` tag。**E409 出现时，第一反应应是「可能已成功」并去核实，而不是「失败了，换个版本号」。**

### 发布后 `npm view ... version` 还是旧版本

registry 缓存延迟。等几秒后重查 `npm view ... versions`，若含新版本且 `dist-tags.latest` 正确即为成功。

> 复核时优先用 `versions`（数组，能看到是否含目标版本）或直连 registry 的 `curl`，**不要只看 `version` 单值**——它最容易读到缓存里的旧版，是本项目误判过一次的根源。判定标准见上文第 7 步。

### 想用 token 自动发布（不每次点 2FA）

可生成 granular access token（选 publish 权限）。但注意 npm 正在限制 2FA-bypass token 直接发布，**建议优先交互式 2FA 发布**；自动化发布可评估 [trusted publishing (OIDC)](https://docs.npmjs.com/trusted-publishing)。

### 本地开发与发布的关系

本地开发用 `link:` 安装（`dsh plugin --profile desktop add /path/plugin`），与 npm 发布互不影响。npm 发布的包是 `lib/`、README 等静态文件，同一份源码。
