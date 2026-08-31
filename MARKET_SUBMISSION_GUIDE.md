# DSH 插件市场申请全流程指南（AI 可复用）

> 本文档把「如何让一个 DeepSeek Harness 插件进入官方社区市场」的完整调研、硬性要求、提交格式、评审逻辑、常见坑与最佳实践整理成一份自包含指南。任何 AI 代理拿到本文档即可独立完成一次插件市场收录申请，无需重新调研。
>
> 最后更新：2026-08-31 · 依据 `dsh-market` 与 `awesome-dsh-plugin` 两个仓库当时的 README / contributing.md / 实际 PR 记录核实。

---

## 1. 先理解生态架构：市场 ≠ 目录

加入市场之前必须先搞清楚两个仓库的分工，这是最容易误解的地方：

| 组件 | 仓库 | 作用 |
| --- | --- | --- |
| **市场应用（店铺）** | [dsh-market/dsh-market](https://github.com/dsh-market/dsh-market) | DSH 设置里的可视化插件市场 UI（浏览/搜索/一键安装/主题）。**只负责展示和安装，不维护插件列表。** |
| **目录注册表（货架）** | [awesome-dsh-plugin/awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) | **插件列表的真正数据源**。市场每天从 `awesome-dsh-plugin.com/plugins.json` 拉取。**申请收录 = 向这里提 PR。** |

> ⚠️ **不要在 `dsh-market/dsh-market` 提插件收录 PR**——官方明确写了 "This repo is the market app, not the catalog… Please don't PR plugin entries against this repo."（会被打回并指去正确的地方。）

**数据流**：你在 `awesome-dsh-plugin` 收录条目 → 合并后 CI 自动重新生成 README → 官网与 `dsh-market` 约一天内自动同步。**收录后无需在 dsh-market 做任何事。**

---

## 2. 申请全流程（5 步）

```
① 确认插件满足硬性要求（见 §3）
② 确定提交格式：普通仓库 or monorepo 子包（见 §4）
③ 准备条目文件 data/plugins/<owner>__<repo>.yml（见 §4）
④ fork awesome-dsh-plugin → 建分支 → 只加这一个文件 → 提 PR（见 §5）
⑤ 等 CI + 维护者人工评审 → 合并 → 一天内进市场（见 §5、§6）
```

---

## 3. 硬性要求 Checklist（提交前逐项自查）

这些是**自动检查 + 人工评审**都会看的。不满足会被打回，满足是收录前提。

### 3.1 插件本身（CI 自动检查）

- [ ] `package.json` 声明 **`dsh.bundle`** manifest —— 这是能用 `dsh plugin add` 安装的前提
  - ⚠️ **最常见的被拒原因：只声明了 `dsh.client` 而没有 `dsh.bundle`**。光有 client 无法安装。
  - 完整示例：
    ```jsonc
    {
      "dsh": {
        "bundle": { "patch": "./cordis.patch.yml" },   // ← 必须
        "client": { "platform": "web" }                 // ← 仅带浏览器 UI 时需要
      }
    }
    ```
    并在仓库内放一个 `cordis.patch.yml`（声明插件行）：
    ```yaml
    - insert:
        - id: your-plugin-id
          name: your-package-name
    ```
- [ ] 仓库有**真实可用的代码**（占位仓库 / 纯 README 仓库 / 名字占坑不收）
- [ ] 仓库**创建满 1 天**且**提交数 ≥ 10**（CI 自动检查；刚建好就发 PR 会被过滤，做完功能再提交即可，复提交不受影响）
- [ ] 仓库**持续维护**（定期扫描会移除：仓库消失、已归档、长期停更的条目）
- [ ] 仓库添加了 **`dsh-plugin`** GitHub topic

### 3.2 条目声明（人工评审重点）

- [ ] **描述必须属实且不带营销词**——描述会被当作对插件的声明，**逐字对照代码核对**。写「46 个工具、六大领域」就得真有 46 个工具和六个领域；提到某命令/API 就得真实存在。**夸大是让好插件被打回的头号原因。**
- [ ] 描述只说功能，不写最高级形容词（"最好的/最强的"）。
- [ ] `description.en` 必填；`description.zh` 可选（写不了中文维护者会补，缺翻译不是打回理由）。
- [ ] 分类选**贴合插件实际功能**的那一个（见 §4.4 分类列表）。选得不准维护者直接改，不会打回。

### 3.3 会被打回的「红线」（评审清单明确列出的）

- ✗ **纯聚合包**：内容只有一份依赖清单、自己不带任何行为的 bundle —— **收插件，不收聚合包**。`hyzyn/dsh-plugin-kit`、`wingsky-1/dsh-plugin-hub` 是正确形态（都发 all-in-one 包，但只收录单个插件）。
- ✗ **依赖不指向上游**：把别人的插件重新上传到自己账号下、再依赖这些副本 —— 收录时依赖必须解析到**原作者仓库或其 npm 包**。
- ✗ **PR 动了无关条目**：更新自己插件时改写了别的插件描述/条目。README 是生成的，**永远只改自己的 `data/plugins/<owner>__<repo>.yml`**。

---

## 4. 条目文件格式（提交物）

**一个插件一个 YAML 文件**，放在 `data/plugins/` 下，命名 `<owner>__<repo>.yml`。两个 README 由脚本生成，**禁止手改**。

### 4.1 普通仓库（插件在仓库根）

```yaml
url: https://github.com/owner/repo        # 必须与仓库完全一致
name: owner/repo                          # 列表显示文字
category: ui                              # 见 §4.4
description:
  en: One-line description ending with a period.
  zh: 一句话描述，以句号结尾。   # 可选，维护者会补
```

文件命名：`data/plugins/owner__repo.yml`（例：`dingminhua__dsh-connect-trae.yml`）

### 4.2 monorepo 子包（插件在子目录，如 `plugin/`）

```yaml
url: https://github.com/owner/repo/tree/main/plugin   # 指向子目录
name: owner/repo#plugin                               # 链接文字带 #子目录
category: model
description:
  en: ...
  zh: ...
```

文件命名：`data/plugins/owner__repo--plugin.yml`（`--` 后面跟子目录路径用 `-` 连接的片段；深层路径如 `packages/my-plugin` → `owner__repo--packages-my-plugin.yml`）。

> 判据：只要**仓库根或某个子包**的 `package.json` 声明了 `dsh.bundle` 即符合。插件放在子目录、根目录没有 `package.json` 时，用子包格式最准确（dsh-market 会据此生成正确的安装命令）。**本次实战用的就是这种格式**（见 §7）。

### 4.3 YAML 语法红线

- ⚠️ **描述中含 `: `（冒号+空格）必须加引号**，否则 YAML 解析成嵌套键报错：
  ```yaml
  description:
    en: 'Vision toolkit: OCR, grounding and pixel diff.'   # ✅ 加引号
  ```

### 4.4 合法分类（category 取值）

```
agi  ui  usage  theme  model  identity  session  memory  tools
wsl  browser  vision  voice  docs  skill  workflow  git  notify
dev  security  remote  market  fun
```
> 分类体系会随规模拆分/合并（`usage`、`vision`、`security`、`browser`、`git`、`docs`、`remote`、`voice` 都是后来从大分类拆出的）。挑最接近的即可，不必纠结。

### 4.5 本地预览（可选）

```sh
npm ci
node scripts/generate-readme.mjs   # 在 awesome-dsh-plugin fork 的 clone 里执行
```
可以本地重新生成看看自己的行长什么样；把生成结果一起提交也接受，但必须与数据源一致。

---

## 5. 提 PR 的标准姿势

1. fork `awesome-dsh-plugin/awesome-dsh-plugin`
2. 建分支，**只添加/修改自己的条目文件**（不要动 README、不要动别人条目）
3. PR 标题规范：`Add owner/repo#subpkg (category)` 或 `Update owner/repo …`（可参考历史 PR 命名）
4. PR 描述写清：插件功能、分类理由、安装方式、符合哪些要求（见 §7 实战模板）
5. 等 CI 绿 + 维护者 review → merge

**PR 被要求修改时的正确心态**：反馈会以 PR 评论给出明确指出要改什么。描述不准不是否定插件本身——**改好那一行就能收录**。复提交/改条目不会留下任何「前科」。

---

## 6. 评审流程（合并前维护者看什么）

CI 绿是**前置条件，不是结论**。CI 只校验形式（manifest、仓库年龄、格式、README 能否重新生成）。维护者合并前人工看：

1. 代码是否与条目声明一致（含描述里的数字与 API 名）
2. 分类是否合理（不准就改，不打回）
3. 是否真实可用的代码，而非占位/空壳
4. 是否已被现有条目覆盖——**重复时规则是「谁更好」，不是先来后到**；分叉只要维护得更好或被收录
5. 源码有无可疑之处（混淆代码、凭据外传、异常安装行为）——但**收录 ≠ 安全审计**，只是常识性检查
6. PR 是否动了无关条目
7. 是否纯聚合包（收插件不收 bundle）
8. 依赖是否指向原作者

---

## 7. 最佳实践（让安装体验更好 / 避免被降级）

- [ ] **发布到 npm**：预构建安装免 `allowBuilds` 构建授权，安装更快。市场会展示 npm install 命令。
- [ ] 不发布 npm？把预构建 tarball 挂到 GitHub Release，用 `tarball:` 字段指向它（必须是 GitHub Release 托管的 `https` `.tgz`）：
  ```yaml
  tarball: https://github.com/owner/repo/releases/latest/download/your-plugin.tgz
  ```
  ⚠️ `latest/download/` 只解析 `latest`，文件名照字面取——**资产名别带版本号**，否则下次发版 URL 就 404；或钉住 release tag（`/releases/download/v1.2.0/...`）。
- [ ] 官方 `@deepseek-ai/*` 包用 **`peerDependencies`** 声明，别用 `dependencies`。且 peer 范围要带显式预发布分支，否则 `>=0.0.1-rc.1 <0.2.0` 这种「看起来很宽」的范围会静默排除所有 `0.1.0-rc.x` 预发布构建，用户会遇到 `ERESOLVE`：
  ```jsonc
  // ❌ 静默排除所有 0.1.0-* 预发布
  "peerDependencies": { "@deepseek-ai/dsh-tools": ">=0.0.1-rc.1 <0.2.0" }
  // ✅ 显式 || 分支带上预发布标签
  "peerDependencies": { "@deepseek-ai/dsh-tools": ">=0.0.1-rc.1 <0.2.0 || 0.1.0-*" }
  ```
- [ ] **配置市场截图**（AppStore 风格卡片图）：**注册表的新约定是「作者自持」**——在插件仓库内、`package.json` 旁放 `screenshots.json`（monorepo 就放在子包目录里），探测脚本自动从 `https://raw.githubusercontent.com/<repo>/HEAD/<子目录>/screenshots.json` 读取，无需向注册表提 PR。三种合法形状（数组 / `{"screenshots": [...]}` / 单 key map）：
  ```json
  // 形状一：路径数组。相对路径解析到插件目录内，禁止 .. 越界；
  //       图片在插件目录外时用绝对 raw URL（host 限 GitHub 托管白名单）
  [
    "https://raw.githubusercontent.com/owner/repo/main/assets/pic_01.png",
    "https://raw.githubusercontent.com/owner/repo/main/assets/pic_02.png"
  ]
  ```
  没配截图的市场会回退到 README 自动提取；配了作者精选截图则展示效果最好。旧版注册表 `data/screenshots.json` 只是遗留 fallback，作者声明后会被自动清理，别往那里提 PR。

---

## 8. 实战案例：dsh-subagent-default-model（2026-08）

**目标**：把 `dingminhua/dsh-subagent-default-model`（子代理默认模型 + 多模型轮换插件）收录进 DSH 市场。

**关键事实**：
- 插件在仓库子目录 `plugin/`（仓库根无 `package.json`），`plugin/package.json` 声明了 `dsh.bundle` manifest
- 仓库创建于 2026-08-16，41 commits，未归档，带 `dsh-plugin` / `dsh-plugin-market` / `dsh-plugins` topic
- 已发布 npm `dsh-subagent-default-model@1.1.1`

**申请动作（已完成 ✅）**：
- PR #1767（2026-08-18 合并）→ 条目 `data/plugins/dingminhua__dsh-subagent-default-model--plugin.yml`
- **采用 monorepo 子包格式**（因为插件在 `plugin/` 子目录）：
  ```yaml
  url: https://github.com/dingminhua/dsh-subagent-default-model/tree/main/plugin
  name: dingminhua/dsh-subagent-default-model#plugin
  category: model
  description:
    en: Configurable default model for subagent delegations via settings.yaml, with single-model and multi-model round-robin or random strategies.
    zh: 通过 settings.yaml 为子代理派发配置默认模型，支持单模型与多模型轮换/随机分配策略。
  ```
- 市场数据源已生效：`awesome-dsh-plugin.com/plugins.json` 含该条目（npm 映射、install 命令、stars/downloads）

**截图配置（已落实 ✅）**：
- 注册表已改用「作者自持截图」**新约定**（`scripts/probe-screenshots.mjs`）：作者在插件仓库内、`package.json` 旁放 `screenshots.json`，探测脚本自动读取 `https://raw.githubusercontent.com/<repo>/HEAD/<子目录>/screenshots.json`，**无需（也不应）再向注册表 `data/screenshots.json` 提 PR**——那是遗留 fallback，作者声明后会被 `prune-legacy-screenshots.mjs` 自动清理。
- 本插件落实方式：在仓库 `plugin/screenshots.json` 声明两张图（绝对 raw URL，host 在 `raw.githubusercontent.com` 白名单内），已推送 main；探测脚本对两张图做 ranged GET 返回 206（live），声明即刻生效。图片在仓库根 `assets/` 时因相对路径禁止 `..` 越出插件目录，须用绝对 raw URL。
- 教训：**初次准备的 yml 用仓库根格式，合并时维护者/提交者改成了子包格式**。提前确认插件是否在子目录、用对格式，能减少一轮往返。
- 教训：**截图声明先查注册表现行约定再动手**——早先以为要往注册表 `data/screenshots.json` 加 key，实际新约定是作者自持文件，方向错了会白费一轮 PR。

**PR 描述模板**（本次实战可用）：
```markdown
Adds [owner/repo](https://github.com/owner/repo) to the `<category>` category.

The plugin declares a `dsh.bundle` manifest at `plugin/package.json`, so the
entry points at the `plugin` subpackage (install command: `dsh plugin --profile
web add <npm-package>`).

- category: `<category>`
- repo: public, N commits, >1 day old, carries the `dsh-plugin` topic
- READMEs regenerated via `node scripts/generate-readme.mjs`
```

---

## 9. 参考资料

- [dsh-market README](https://github.com/dsh-market/dsh-market#readme)（明确「这是店铺不是目录」）
- [awesome-dsh-plugin README](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)（含「What it takes to be listed」）
- [awesome-dsh-plugin contributing.md](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)（完整收录标准与评审清单）
- 市场数据源：<https://awesome-dsh-plugin.com/plugins.json>
- 本次实战 PR：[#1767](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/1767)
