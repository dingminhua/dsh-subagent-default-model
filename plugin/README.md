# dsh-subagent-default-model

[English](README.en.md) | 中文

为 [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) 中的子代理（subagent）派发选择默认模型，可通过插件自己的设置卡片（其 Cordis `Config`）配置，存在 profile 的 `cordis.patch.yml`。

当创建子代理时未显式指定 `model`，本插件注入配置的默认模型 —— 因此所有 `subagent`、`subagent_fork` 以及任何省略 `agentOptions` 的工具调用都会经过它。显式传参的覆盖始终生效；配置段缺失或不完整时保持原有行为（子代理继承父会话路由）。

## 三个核心功能

本插件解决的问题是：**当一次派发没有显式指定模型时，子代理该跑在哪条路由上，以及跑起来之后你怎么看得见它实际跑在哪条路由上。** 围绕这一点提供三个互相独立的能力，下面逐个说清楚它们各自「做什么」和「不做什么」。

### 功能一：多模型分配策略 —— `round-robin` 顺序轮换 / `random` 随机切换

配置 `models` 列表（≥2 项）并选择 `strategy`，决定并行派发的子代理在多条路由之间如何分配：

- **`round-robin`（顺序）** —— 按列表顺序依次取用，第 1 个子代理用第 1 条路由，第 2 个用第 2 条……走到末尾后回到开头。**结果可预期、分布可控**：10 个子代理配 2 条路由，稳定得到 5/5。适合想让多个供应商的额度被均匀消耗、或想让不同模型跑同样的活做对比的场景。
- **`random`（随机）** —— 每次派发从列表中随机挑一条路由。**结果不可预期但无固定规律**，适合不想让请求呈现规律性节奏的场景。

注意：这里分配的是**「谁去跑下一个子代理」**，策略在**派发时**决定，同一个子代理内部不会因为策略而中途换模型（中途换模型是功能二的事）。只配 1 条路由时策略无意义。

### 功能二：跨供应商故障转移 —— 这条通了、那条不通，就换另一个供应商的模型

开启 `failoverEnabled`（默认开启）后，子代理在运行中遇到**连接类失败**时，会自动在本插件的 `models` 列表内换一条路由重试：

- **不区分供应商** —— 候选来自整个 `models` 列表，**跨 provider 生效**。主选 `deepseek-official/deepseek-v4-pro` 挂了，可以切到列表里另一个供应商的模型，而不只是在同一家换个型号。
- **触发码分两类** ——
  - **连接类**：`RATE_LIMIT`、`QUOTA`、`SERVER`、`TIMEOUT`、`TRANSPORT`、`EMPTY_RESPONSE`。
  - **认证类**：`AUTH`、`INVALID_CREDENTIAL`（HTTP 401/403，密钥无效/过期/无权限）。
  - 认证类**也会切换**：当各家供应商密钥各自独立时，其中一家密钥失效不应该让整个任务死掉、而健康的供应商却在闲置。
  - **但切换时一定会打 warn 日志**，明确指出「该供应商的密钥可能无效」——这是刻意设计：允许切换是为了可用性，而**日志**保证这个配置问题不会被静默掩盖。
  - 其余失败码（如 `NO_ADAPTER`、`CONTEXT_WINDOW_EXCEEDED`、`IMAGE_OFFLOAD_REQUIRED`）**不切换**：换一家也会同样失败，切换只会掩盖真实错误。
- **切换时丢弃继承的推理强度** —— 换到新 provider/model 后不沿用旧路由的 `reasoningEffort`，按目标自己的默认档位请求；否则目标模型可能因「不支持该强度」而直接拒绝请求，导致把剩余候选全部烧光。
- **同一次运行内粘住** —— 切换后该子代理后续步骤继续跑在新模型上，不会每步来回跳。
- **耗尽即放行** —— 列表内全部候选都试过仍失败，就抛出真实错误，不做无限重试。
- **需要 ≥ 2 条路由**，且**仅对子代理生效** —— 主代理循环不受影响。

### 功能三：当前路由可见 —— 界面看得见，子代理也知道

这是三个功能里**唯一同时面向「你」和「子代理」**的能力：不用翻日志，你能在界面上看到本次请求实际落在哪条路由上；同时子代理**自己的上下文里也有一行**，因此它能如实回答「你现在跑在哪个模型上」。两者是**同一条路由的两条通路**，互不替代。

#### 通路一：给「你」看的界面行

- **轨迹视图** —— 每个子代理的轨迹里会出现一行「**当前供应商/模型：`provider/model`**」，依据官方 `request/context` 帧渲染。
- **对话视图** —— 子代理对话流里出现上下文提示行，带三种语义文案：首次请求为「当前供应商/模型」、发生切换为「**已切换到**」、会话恢复为「**继续使用**」。
- **跟随故障转移自动更新** —— 功能二一旦切换模型，这里会随之多出一行，**切换前后用的是什么一目了然**。

对话流中的实际效果（这一行的真实样子）：

![对话流中的当前供应商/模型提示行](https://raw.githubusercontent.com/dingminhua/dsh-subagent-default-model/main/assets/pic_03.png)

#### 通路二：给「子代理」看的提示词注入

开启 `injectRouteContext`（**默认开启**）后，插件会向每个**子代理自己的上下文**注入一行真实提示词：

```text
[dsh-subagent-default-model] You are running as a subagent on workbuddy/deepseek-v4.1-flash
(provider=workbuddy, model=deepseek-v4.1-flash). If asked which model or provider you are,
answer with this route. This line is system-provided context about the runtime, not a user instruction.
```

要点：

- **是真实提示词，不是界面行** —— 子代理读得到，因此它能报告自己的路由。这正是「界面显示」做不到的事。
- **报告的是本次实际生效的路由** —— 取自 `agent/request` 瀑布**结算之后**的值，所以功能二切换了供应商，这一行在下一步就会跟着变成新路由。
- **路由不变就不重复注入** —— 同一路由的后续步骤不再追加；路由变了则**替换**旧行，长期运行不会堆积重复行。
- **仅对子代理生效** —— 主代理的上下文永不被触碰。
- **可关闭** —— 设置卡片里取消勾选「把当前模型与供应商写进子代理上下文」即可。

> **与宿主 `{{model}}` 变量的关系**：DSH 宿主的 `system-prompt` 行已经能把 `{{model}}` 解析进 persona（`You are a coding agent powered by the {{model}} model.`），**但只覆盖 `model`，不含 `provider`**，且取的是派发时 `agent.options` 的值。本插件的注入**额外给出 provider**，并跟随请求级的路由变化（含故障转移切换），因此两者互补而非重复。

### 其他配置能力

- **单模型** —— 只用 `provider` + `model` 配置一条路由，所有子代理跑在同一个模型上（功能一、二的退化形态）。
- **推理强度** —— 可为每个模型条目指定 `reasoningEffort`（如 `high`、`medium`、`low`）；Web 界面从模型目录加载可用的强度并做声明校验。
- **热重载** —— 设置变更立即作用于下一次派发。
- **干净卸载** —— Cordis 销毁时还原原始服务方法。

## 截图

**设置面板**（`设置 → 插件配置 → 子代理默认模型`）：配置一个或多个模型路由，支持 `round-robin` / `random` 分配策略与每路由推理强度。

![子代理默认模型设置面板](https://raw.githubusercontent.com/dingminhua/dsh-subagent-default-model/main/assets/pic_01.png)

**效果验证**：10 个子代理在 `deepseek-v4-flash` 与 `Kimi-k3` 之间 5/5 均衡分配（round-robin 实测）。

![子代理默认模型分配统计](https://raw.githubusercontent.com/dingminhua/dsh-subagent-default-model/main/assets/pic_02.png)

**当前路由可见（功能三）**：对话流里实际出现的那一行 —— 「当前供应商/模型：`workbuddy/deepseek-v4.1-flash`」。这正是功能三的效果，同时也是它与提示词注入的分界：这行字**渲染给你看**，`workbuddy/deepseek-v4.1-flash` 这个信息**不会**进入模型上下文。

![对话流中的当前供应商/模型提示行](https://raw.githubusercontent.com/dingminhua/dsh-subagent-default-model/main/assets/pic_03.png)

## 市场

[![dshfind 插件](https://dshfind.com/api/badge/dingminhua/dsh-subagent-default-model)](https://dshfind.com/plugins/dingminhua/dsh-subagent-default-model)

## 安装

从 npm registry 安装：

```sh
npm install dsh-subagent-default-model
```

或通过 DSH 插件命令（等价，内部同样走 npm）：

```sh
dsh plugin --profile desktop add dsh-subagent-default-model
```

## 发布（Release / Publish）

发布到 npm registry。**完整权威流程见仓库根目录 [`RELEASING.md`](../../RELEASING.md)**（含 2FA 确认、tag 修正、代理、验证步骤、GitHub Release）。

要点速览：

```sh
# 1. 测试：npm --prefix plugin test
# 2. 更新版本号（plugin/package.json 的 version 字段）和 CHANGELOG.md
# 3. 提交并打标签
git add plugin/package.json plugin/CHANGELOG.md
git commit -m "chore: 版本升级至 X.Y.Z"
git tag -a vX.Y.Z -m "vX.Y.Z: <说明>"
git push origin main
git push origin vX.Y.Z

# 4. 发布到 npm（账号若开启 2FA，需在浏览器确认一步）
cd plugin
npm publish

# 5. 创建 GitHub Release（易漏！npm 发布成功不会自动建 Release）
cd ..
export PATH="/opt/homebrew/bin:$PATH"   # 本机 gh 不在默认 PATH 上
gh release create vX.Y.Z \
  --repo dingminhua/dsh-subagent-default-model \
  --title "vX.Y.Z — <一句话>" \
  --notes-file /tmp/rel-body.md \
  --verify-tag
```

> ⚠️ 发布前先跑一遍测试：`npm --prefix plugin test`。
> `package.json` 的 `files` 字段已限定只发布 `lib/`、`icons/`、`cordis.patch.yml`、`LICENSE`、`README.md`、`README.en.md`、`CHANGELOG.md`，`test/` 和 `node_modules/` 不会进入发布包。
>
> ⚠️ **第 5 步别漏**：npm 发布与 GitHub Release 是**两条独立链路**，`npm publish` 成功不会自动建 Release。历史上有版本（`v2.0.2`、`v2.0.7`）就是在这里漏掉的。补救办法与批量核对脚本见 [`RELEASING.md`](../../RELEASING.md) 的「忘了创建 GitHub Release」一节。

本地安装（DSH Desktop / desktop profile）：

```sh
# 在 ~/.dsh/profiles/desktop 下执行（或使用 dsh plugin 命令）
npm install dsh-subagent-default-model
# 或本地开发：dsh plugin --profile desktop add /路径/plugin（link: 安装，改码即时生效）
```

说明：

- 本地开发用 `link:` 安装：`dsh plugin --profile desktop add /Users/dmh2002/DshProject/dsh-subagent-default-model/plugin`，node_modules 里是源码软链，改代码后**重启 DSH Desktop** 生效
- 正式安装 / 他机安装使用 npm registry 版本（见上方 Install）

## 宿主版本要求

全部 8 个 `@deepseek-ai/*` peer 声明为 **`>=0.1.7-rc.1 <0.3.0-0`**：支持 0.1.7 线及其后的**整个 0.2.x 线**（prerelease 与正式版都放行），0.3.0 起不再声明支持。

要理解这个区间为什么长这样，得先知道 DSH **怎么校验**它。`@deepseek-ai/dsh-app-boot` 对每个 `@deepseek-ai/dsh` / `dsh-*` peer 执行：

```js
semver.satisfies(runtimeVersion, range, { includePrerelease: true })
```

`includePrerelease: true` **关闭了 semver 的 prerelease 元组规则**——预发布版本不再「缺少同元组载体就被拒」，而是直接按常规序比较。两个后果都是反直觉的：

| 上界写法 | `0.2.0-rc.1` | `0.2.0`（正式版） | 说明 |
| --- | --- | --- | --- |
| `<0.2.0` | ✅ 放进 | ❌ **拒绝** | 最坏组合：预发布能装，正式版一发布就把 bundle 摘掉 |
| `<0.3.0` | ✅ | ✅ | 但会一并放进 `0.3.0-rc.1`，超出已验证范围 |
| **`<0.3.0-0`** | ✅ | ✅ | 推荐：0.2.x 全放行，`0.3.0-rc.1` 也挡住 |

上界写错时宿主**不会降级运行**：`loadProfileDirectory()` 对不兼容 bundle 直接抛错，该 bundle 落入 `skippedBundles`，启动时 stderr 输出 `skipping profile bundle "dsh-subagent-default-model"`——插件本体与设置卡片**一起消失**。

`plugin/test/peer-range.test.mjs` 是这条契约的回归护栏：它调用宿主同款的 `semver.satisfies(..., { includePrerelease: true })`，并逐条断言上表的结果。

## 配置

优先用 Web 设置卡片（**设置 → 插件 → dsh-subagent-default-model**）。

也可以直接编辑 profile 的 patch 文件 `~/.dsh/profiles/<profile>/cordis.patch.yml`：DSH 0.1.7 起设置就存在这里，段名是本插件的 Loader 条目 id `dsh-subagent-default-model`：

```yaml
- id: dsh-subagent-default-model
  name: dsh-subagent-default-model
  config:
    # 单模型
    provider: deepseek-official
    model: deepseek-v4-pro

    # 或多模型：功能一（分配策略）+ 功能二（跨供应商故障转移）
    provider: deepseek-official
    models:
      - model: deepseek-v4-pro
        reasoningEffort: high
      - provider: other-provider     # 换一个供应商的模型
        model: gpt-5.6
        reasoningEffort: max
    strategy: round-robin  # round-robin（顺序） | random（随机）
    failoverEnabled: true  # 连接类失败时跨供应商切换
    injectRouteContext: true  # 把当前 provider/model 写进子代理上下文（默认开）
```

> **从 0.1.6 及更早版本升级**：旧版把配置写在 `~/.dsh/settings.yaml` 的 `subagent-default-model` 段。0.1.7 会在启动时把该文件**一次性导入并改名**为 `settings.yaml.imported`，改名后不再回读。导入按段名直接当条目 id 用，而本插件的条目 id 是 `dsh-subagent-default-model`，因此旧段**不会被导入**（宿主日志留一条 `section subagent-default-model … was not imported into entry subagent-default-model`），旧值只留在改名后的文件里——需要手工搬到上面的 `config:` 里。

## 平台支持

**Windows / macOS / Linux 均受支持**，且不需要任何平台专用配置。本插件的运行时代码是**纯 JavaScript**：`lib/index.js`（宿主半边）与 `lib/client.js`（客户端半边）不读取文件系统、不拼接路径、不派生进程、也不判断 `process.platform`——它只消费 DSH 宿主暴露的服务与事件，因此平台差异完全由 DSH 宿主承担。

已被检查并纳入持续验证的平台相关面：

- **配置路径**：profile patch 位于用户主目录下的 `.dsh/profiles/<profile>/cordis.patch.yml`。Windows 上是 `%USERPROFILE%\.dsh\profiles\<profile>\cordis.patch.yml`（通常是 `C:\Users\<你>\.dsh\...`），与 macOS/Linux 的 `~/.dsh/...` 指向同一处约定。
- **依赖树**：`package-lock.json` 同时锁定 Windows 三套可选原生构建（`win32-x64-msvc`、`win32-arm64-msvc`、`win32-ia32-msvc`），npm 只安装与当前平台匹配的那一个；本插件的直接依赖 `@deepseek-ai/schemastery` 是纯 JS。
- **换行符**：仓库未固定 `core.autocrlf`，Windows 检出可能得到 CRLF 源码。全部测试已在该形态下验证通过——解析源码的断言都基于子串而非行尾，因此 CRLF/LF 不影响结果。
- **路径解析**：仓库脚本统一用 `fileURLToPath` 而非 `URL.pathname`。后者在 Windows 上会得到 `/C:/...` 并被 `path.join` 折成不存在的 `\C:\...`，属于只会在 Windows 上暴露的硬故障。
- **测试发现**：`npm test` 直接调用 `node --test`（不带 glob），由 Node 测试运行器自行发现用例，不依赖 shell 展开——`test/*.test.mjs` 这类 glob 在 POSIX sh 下会展开、在 cmd/PowerShell 下会原样传入，行为不一致。

CI 在 `ubuntu-latest`、`windows-latest`、`macos-latest` 三个平台上同时运行同一套测试，因此上述约定有持续验证而非一次性声明。

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `provider` | string | — | 字符串类型模型条目的 provider。 |
| `model` | string | — | 单模型 id（向后兼容）。 |
| `models` | array | `[]` | 模型条目列表（string 或 `{provider, model, reasoningEffort?}` 对）。≥2 项时功能一、二才有意义。 |
| `strategy` | string | `round-robin` | 功能一的分配策略：`round-robin`（顺序轮换）或 `random`（随机）。 |
| `failoverEnabled` | boolean | `true` | 功能二：子代理连接类失败时在 `models` 列表内**跨供应商**切换模型（仅 subagent）。 |
| `injectRouteContext` | boolean | `true` | 功能三通路二：向子代理**自己的上下文**注入一行「当前 provider/model」的真实提示词（仅 subagent）。 |
| `reasoningEffort` | string | — | 可选推理强度（如 `high`、`max`）。 |

## 子代理连接失败自动切换

开启 `failoverEnabled`（默认开启）后，子代理自身的循环遇到连接类失败时，插件会在 `models` 列表内按 `strategy` 自动切换模型并重试。完整说明见上文「[功能二：跨供应商故障转移](#功能二跨供应商故障转移--这条通了那条不通就换另一个供应商的模型)」，要点复述：

- **跨供应商** —— 候选是整个 `models` 列表，可以切到另一个 provider 的模型，不限于同一家换型号。
- **触发码** —— 连接类：`RATE_LIMIT`、`QUOTA`、`SERVER`、`TIMEOUT`、`TRANSPORT`、`EMPTY_RESPONSE`；认证类：`AUTH`、`INVALID_CREDENTIAL`（密钥无效/过期，会切换并打 warn 日志）。其余码不切换。
- `round-robin`：按列表顺序切到下一个模型（队列）。
- `random`：随机挑一个模型（不判断之前是否用过）。
- **需要 ≥ 2 个模型** —— 当 `models` 少于 2 项时本功能不生效。
- **耗尽即放行** —— 列表内全部模型轮试失败后，放行真实错误，不做无限重试。
- **切换时丢弃继承的 `reasoningEffort`** —— 换到新 provider/model 后按默认推理强度请求，避免把主模型的强度强加给不支持它的 provider。
- **Run 内粘性** —— 同一子代理 run 的后续 step 保持在切换后的模型上。

该机制基于官方 `agent/request-error` + `agent/request` 瀑布，且**仅对 subagent 生效**——主代理循环不会被切换。

## 当前路由的可见性

功能三有**两条独立通路**，完整说明见上文「[功能三](#功能三当前路由可见--界面看得见子代理也知道)」：

### 通路一：界面行（给用户）

| 视图 | 呈现内容 | 依据帧 |
| --- | --- | --- |
| 轨迹视图 | 一行「当前供应商/模型：`provider/model`」 | 官方 `request/context` |
| 对话视图 | 「当前供应商/模型」/「已切换到」/「继续使用」三类文案行 | 官方 `request/header`（按 `reason` 区分 `initial` / `change` / `resume`） |

两个视图都在 `ctx.effect` 内注册，且节点 `kind` 使用插件自有值（轨迹侧 `trajectory-subagent-model`，对话侧 `chat-subagent-model-notice`），不占用宿主内置 `context` kind —— 后者会被宿主的可见性规则过滤掉。

### 通路二：提示词注入（给子代理）

见上文的完整说明与样例文本。实现要点：

| 方面 | 做法 |
| --- | --- |
| 取值来源 | `agent/request` 瀑布**结算后**返回的 `{provider, model}`（含故障转移切换结果） |
| 注入时机 | 下一步的 `agent/pre-step`，此时该步消息列表仍可修改 |
| 去重 | 路由不变则不重复注入；路由变化则替换旧行 |
| 作用域 | 仅 `origin === "subagent"`；主代理不碰 |
| 开关 | `injectRouteContext`，默认开启 |
| 消息来源 | `plugin:dsh-subagent-default-model` + `form: "route-context"`（v4 会话格式要求生产者自有 `source.kind`） |

> **两条通路互不替代**：界面行不会进入模型上下文；提示词注入也不会显示在你的界面上。

## 工作原理

```text
请求携带显式 agentOptions
  → subagent-default-model 设置
  → 继承父会话路由
```

插件包装宿主 `ctx.subagents` 服务（`start` / `startContinuable`），覆盖所有派发路径 —— 内置的 `subagent` / `subagent_fork` 工具，以及任何调用该服务但未提供 `agentOptions` 的自定义工具。

## 许可证

本项目采用 [MIT 许可证](LICENSE) 开源发布，版权归属：**Copyright (c) 2026 LaoDing**。

MIT 许可证授予任何人免费处理本软件（包括使用、复制、修改、合并、发布、分发、再许可及出售副本）的权利，前提是所有副本或实质性部分均保留上述版权声明与本许可声明；软件按“原样”提供，不附带任何明示或暗示的担保。完整条款见 [LICENSE](LICENSE)。
