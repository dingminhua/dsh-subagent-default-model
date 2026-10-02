# 本地开发工作流（DSH Desktop + desktop profile）

> 📦 发布流程见 [`RELEASING.md`](RELEASING.md)。

## 一句话原则

**用 `dsh plugin add` 以 `link:` 方式装入 desktop profile，改代码即时生效（重启 DSH Desktop 生效），不复制文件、不重装依赖树。**

## 当前环境

- **运行实例**：DSH Desktop 应用（端口 3081 pocket / 43120 主界面），加载 `~/.dsh/profiles/desktop` profile
- **安装方式**：`dsh plugin --profile desktop add` 走 pnpm `link:` 本地链接——node_modules 里是源码目录的软链，改源码后无需重新安装
- **历史遗留**：旧的 `dev-web.sh` + `web` profile（端口 3080）工作流已废弃并删除，请勿重新引入

## 正确流程

1. **安装（首次/重装）**

   直接用 `dsh plugin` 命令在**新版桌面壳上已不可用**——它会拒绝：

   ```text
   error: profile "desktop" is managed exclusively by the Electron application
   ```

   正确入口是 **DSH Desktop 内的插件管理**（设置 → 插件 → 安装本地包，或让 AI 会话走 `plugin_manager` 工具的 `install_bundle`），target 传**插件包的绝对路径**：

   ```text
   /Users/dmh2002/DshProject/dsh-subagent-default-model/plugin   # macOS / Linux
   C:\Users\<你>\DshProject\dsh-subagent-default-model\plugin     # Windows
   ```

   安装结果等价于把该路径以 `link:` 写进 `~/.dsh/profiles/desktop/package.json` 的 `dependencies`，并 reconcile `dsh.profile.bundles` 列表。以 `link:` 安装不会重装依赖树，**不触发模块双胞胎**。

   安装后核对（宿主实时读回）：

   - `dsh.profile.bundles` 含 `dsh-subagent-default-model`
   - `node_modules/dsh-subagent-default-model` 是指向源码 `plugin/` 的软链
   - `listConfigs name=dsh-subagent-default-model` 返回条目 `id: include:dsh-subagent-default-model`

2. **改代码后**
   ```bash
   # 源码在 plugin/ 下，node_modules 里是 link 软链，直接生效
   # 但 bundle patch 与 host/client 半边在启动时加载，需要整进程重启：
   # 退出 DSH Desktop → 重新打开
   #   macOS：⌘Q     Windows：Alt+F4 或从托盘/任务栏退出
   ```
   `plugin/lib/index.js`（host 半边）改动需重启；`plugin/lib/client.js`（client 半边）在页面刷新后即可重载。

3. **改了 `package.json` 依赖时**
   - 在 desktop profile 里重新 `add` 即可（`link:` 重新解析）
   - 旧文档的 `fix-module-twins.sh` 已不存在，`link:` 安装也不会制造双胞胎，无需处理

## 平台影响面（每次改动都要过的检查）

**Windows 是一等目标平台，不是事后补丁对象。** DSH 桌面壳在 Windows 上分发，任何改动都要先回答「这在 Windows 上是什么行为」，再回答「在 macOS 上是什么行为」。以下清单在每次改动后被复查（CI 的 `windows-latest` 任务覆盖其中可自动化的部分，其余靠评审）：

| 面 | 规则 | 为什么 |
| --- | --- | --- |
| **路径解析** | 一律用 `fileURLToPath(new URL(...))`，禁用 `new URL(...).pathname` | `pathname` 在 Windows 得到 `/C:/...`，`path.join` 会折成不存在的 `\C:\...`；且不解析 `%20` 等转义。该形态在 macOS/Linux 上两者一致，**只在 Windows 暴露** |
| **路径拼接** | 一律 `node:path` 的 `join`/`resolve`/`dirname`，禁止手拼 `/` 或 `\` | 分隔符不同；手拼在 Windows 上会得到混合分隔符并可能失效 |
| **shell 依赖** | 脚本不要依赖 shell 展开（glob、`&&` 之外的语法、`$VAR` 以外的东西） | `test/*.test.mjs` 在 POSIX sh 下展开，在 cmd/PowerShell 下原样传入 |
| **测试发现** | `npm test` 用 `node --test`（不带 glob），由 Node 自行发现 | 与上一条同因；这是当前已采用的形态 |
| **换行符** | 解析源码/文本的断言只做子串匹配，不要基于 `\n` 切行 | Windows 检出可能得到 CRLF（仓库未固定 `core.autocrlf`） |
| **依赖树** | 新增依赖前确认跨平台（含可选原生构建是否在 lockfile 里覆盖 win32） | 本仓在 macOS 上开发，`npm install` 会把平台专属文件固化进 lockfile |
| **进程/信号** | 不假设 POSIX 信号与可执行权限（`chmod`、`SIGTERM`、`/bin/sh`） | Windows 无对应语义 |
| **大小写** | 导入路径与实际文件名大小写一致 | Windows 文件系统不区分大小写，macOS 默认也不区分，**只有 Linux 会失败**——反向同理 |

**CI 门禁**：`.github/workflows/ci.yml` 在 `ubuntu-latest`、`windows-latest`、`macos-latest` 上跑同一套测试。新增脚本或测试时不要绕过 `npm test`，否则该改动在 Windows 上不受验证。

## 宿主版本契约（改 `peerDependencies` 前必读）

DSH 校验 peer 时**不用默认 semver 选项**。`@deepseek-ai/dsh-app-boot` 对每个 `@deepseek-ai/dsh` / `dsh-*` peer 执行：

```js
semver.satisfies(runtimeVersion, range, { includePrerelease: true })
```

`includePrerelease: true` 会**关闭 prerelease 元组规则**，于是上界附近的判定变得反直觉：

| 上界写法 | `0.2.0-rc.1` | `0.2.0`（正式版） | 结论 |
| --- | --- | --- | --- |
| `<0.2.0` | ✅ 放进 | ❌ **拒绝** | 最坏：预发布能装，正式版一发布整个 bundle 被摘 |
| `<0.3.0` | ✅ | ✅ | 但放进 `0.3.0-rc.1`，超出已验证范围 |
| **`<0.3.0-0`** | ✅ | ✅ | 当前采用：0.2.x 全放行，`0.3.0-rc.1` 也挡住 |

规则：

- **上界必须带 `-0`**，否则会静默放进下一行的 prerelease。
- **不要为了「只支持 0.1.7」而写 `<0.2.0`**——它挡不住 `0.2.0-rc.1`，却挡住正式的 `0.2.0`。
- 上界写错时宿主**不降级**：`loadProfileDirectory()` 抛错 → 该 bundle 进 `skippedBundles` → stderr 输出 `skipping profile bundle "dsh-subagent-default-model"`，插件本体与设置卡片一起消失。
- `plugin/test/peer-range.test.mjs` 是护栏，**必须与 `package.json` 同步改**；它调用宿主同款的 `semver.satisfies(..., { includePrerelease: true })`，并用手写回退实现做交叉验证（不支持的 `^` / `~` 语法会抛错而非静默返回 `false`）。
- 想诚实表达「仅 0.1.7 线」时，正确写法是 `>=0.1.7-rc.1 <0.2.0-0`（同时挡住 `0.2.0-rc.1` 与 `0.2.0`），而不是 `<0.2.0`。

## 不要做的事

- ❌ 重新创建 `dev-web.sh` 或 `web` profile（3080 旧工作流已废弃）
- ❌ 手动把 `plugin/lib` 复制进 node_modules（`link:` 已保证实时同步）
- ❌ 手动在 `~/.dsh/profiles/desktop` 里跑 `pnpm install` 重装整个依赖树
- ❌ 把 peer 上界写成裸 `<0.2.0`（见上一节：挡不住预发布、却挡住正式版）

## 设置命名空间白名单（当前版本已不需要）

旧文档提到需要把 `subagent-default-model` 加入 `WEB_SETTINGS_NAMESPACES` 白名单。当前 DSH 版本（dsh 0.1.1-rc.2）的 `dsh-host-apiproxy` 已移除该白名单机制，`settings.describe` 直接返回全部已注册 namespace，**无需任何 patch**。

## 测试

```bash
npm --prefix plugin test    # 全套单元测试（含跨平台守卫）+ peer 区间护栏；判定看 fail 0
node integration.mjs        # 派发与生命周期集成测试
node prove.mjs              # Cordis traceable-proxy 回归测试
```

> 用例数刻意不写死（已从 92 → 112 → 116 → 120 漂移多次）。判定标准是
> `node --test` 汇总里的 **`fail 0`**，以及 **`pass` 等于 `tests`**。

辅助脚本（本地验证用）：

```bash
npm --prefix plugin run mock       # 启动 mock LLM 服务器（默认 127.0.0.1:8799）
npm --prefix plugin run simulate   # failover 端到端模拟，写入 preview-trajectory-model.html
node plugin/scripts/verify-mock-failover.mjs   # 需先起 mock：真实 429 → 切换 → 真实 200
```

三个平台上的等价执行由 CI 保证；本地在 Windows 上开发时，上述命令在 PowerShell / cmd 中同样可用（不依赖 shell 展开）。

## 测试夹具必须忠于宿主语义（三个真实教训）

**这一节是本仓最贵的一课。** 2.1.1–2.1.4 期间连续三个 P0 缺陷**全都通过全部测试**、却只有**真实运行**才暴露，根因是同一个：**夹具比宿主「宽松」**。夹具是代码，它读起来像在验证真实行为，但它验证的其实是「我理解的宿主」。

规则：**夹具只能在「无法真实构造」的地方替身服务；凡是有明确语义的宿主行为（事件顺序、API 的可变性、生命周期），必须逐条照抄，并注明出处。**

### 案例一：`inbox.claim()` 抽干 inbox，去重判断恒为 false

**缺陷**：每个 step 都重复注入一次路由行。真实会话实测 **1228 步注入 1227 次**（累计 368,052 字符 ≈ 12 万 token）。

**夹具的错**：`makeInbox()` 只实现了 `prepend` / `remove`，**没有 `claim()`**。于是上一步的消息一直躺在 `nextStep` 里，让「inbox 里是否已有同样一行」这个去重判断**看起来有效**。

**宿主的真相**（`dsh-agent-loop`）：`preStep()` 的**第一件事**就是 `inbox.claim()`，而它会**整表抽干**：

```js
claim(target, turn) {
  const claimed = this.mutate("next-step", 0, this.nextStep.length, [], false);
  //                                         ^^^ 全删
```

且这一步发生在 `agent/pre-step` 瀑布**之前** —— 轮到我方监听器时，待处理列表**必然是空的**，去重判断**结构上恒为 false**。

**修法**：去重改为**带外状态**（按 `agent.id` 记录上次注入的文本），不再依赖 inbox 内容；夹具补上 `claim()`，并让 `dispatchPreStep()` 在瀑布前先调用它。

### 案例二：`requestContext()` 是「折叠最新帧」，不是常量

**缺陷**：注入的路由**滞后一步**，模型上下文里出现**互相矛盾的两行**（一行 `glm`、一行 `ds41`）。

**夹具的错**：`makeAgent()` 把 `session.requestContext()` 固化成**常量**：

```js
requestContext: () => ({ provider: "deepseek-official", model: "deepseek-v4-pro" })  // ❌
```

常量意味着**夹具里根本没有路由变化**，注入器读到什么都「对」。

**宿主的真相**（`dsh-session`）：它**折叠**最新一条 `request/context` 事件，文档原文即 *"the latest resolved route metadata"*：

```js
requestContext() {
  if (this.contextFoldSeq < this.log.length) {
    for (const event of this.log.slice(this.contextFoldSeq))
      if (event.type === "request/context") this.contextFold = deepFreeze({ ...event.data })
```

**修法**：夹具改为**可变状态** + `commitRoute()`，由 `dispatchRequest()` 在瀑布结算后提交，与宿主一致。

### 案例三：瀑布顺序就是语义 —— `preStep` 先于 `buildRequest`

**缺陷**：首步读不到路由，回落 `agent.options`（**派发时的意图值**）写成一行猜测，而真实路由当场就变了。

**夹具的错**：驱动顺序是「先 `agent/request`，再 `agent/pre-step`」—— **与宿主相反**。夹具因此永远看不到「请求尚未构建」这个状态。

**宿主的真相**（`dsh-agent-loop`）：每轮迭代是

```text
preStep()       ← :954   本插件的注入点
buildRequest()  ← :1063  → 这里才触发 agent/request
```

所以**第一步的 pre-step 执行时，`request/context` 帧尚不存在**。

**修法**：注入只报告**已知为真**的路由，优先级为 ① `session.requestContext()` → ② `agent/request` 瀑布结算后的种子 → ③ **不回落** `agent.options`。第 ③ 条是取舍：**注入行只是对现实的陈述，立刻被推翻的猜测比不说更糟**，故路由已知前保持沉默。

### 复盘：为什么三次都没被测试拦住

| 案例 | 夹具缺了什么 | 宿主中的对应语义 |
| --- | --- | --- |
| 一 | 没有 `claim()` | `preStep` 开头抽干 inbox |
| 二 | `requestContext` 是常量 | 折叠最新 `request/context` 的可变值 |
| 三 | 瀑布顺序与宿主相反 | `preStep` 先于 `buildRequest` |

三者是同一个错误的三种形态：**夹具在「宿主会拒绝/会变化/会有序」的地方一律放行**。

### 因此，每个注入/拦截类用例都应回答三个问题

1. **顺序**：宿主在哪一刻调到我？我之前之后各发生了什么？（去读宿主源码行号，别凭印象）
2. **可变性**：我依赖的那个值，宿主中是**常量还是会被改写**？改写者是谁？
3. **边界**：宿主会不会**先清空 / 先消费**我要读的东西？

> 判据：**「若把宿主换成夹具，行为会不同吗？」** 若会，夹具就不合格。
> 三个案例的修正方式都遵循同一条：**不再让代码依赖「夹具恰好保留了什么」，而是让夹具如实复现宿主会做什么。**

## 验证清单（修改后）

1. 重启 DSH Desktop
2. 打开 **设置 → 插件 → dsh-subagent-default-model**，确认设置卡出现（`view: 'page'` 默认展开）
3. 保存后确认 `~/.dsh/profiles/desktop/cordis.patch.yml` 里 `id: dsh-subagent-default-model` 条目的 `config:` 更新
4. 创建一个不带显式 `agentOptions` 的子代理，确认其路由到配置的默认模型

> **宿主只在启动时加载插件一次。** 改动 `lib/` 后必须重启 DSH 才生效 —— 改文件不等于改正在运行的程序。
> 排查时先核对**进程启动时间 vs 文件修改时间**，否则会把「旧代码的行为」误判为新缺陷（本仓实际发生过两次）。

## 历史遗留：旧 settings.yaml 不会被导入

0.1.6 及更早，本插件把配置注册为 `~/.dsh/settings.yaml` 的 `subagent-default-model` 段。0.1.7 起设置模型整体重建，该文件在启动时被**一次性导入并改名**为 `settings.yaml.imported`，此后不再回读。

导入按段名直接当条目 id 用（只有 `ui-developer-tools`/`ui-onboarding`/`shell` 三个历史段有重映射表），而本插件的条目 id 是 `dsh-subagent-default-model`，因此 `subagent-default-model` 段**导入失败**，宿主日志留一条：

```text
[settings-forms] settings: section subagent-default-model of …/settings.yaml.imported was not imported into entry subagent-default-model
```

旧值只留在 `.imported` 文件里，需要手工搬进 profile patch 的 `config:` 块（本仓实际发生过一次，见 CHANGELOG）。
