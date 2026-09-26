# Changelog

## 2.0.6 (2026-09-26)

### Fixed

- **真机报告：「删掉一个路由，保存，删掉的那个又出现了」**。保存不再报错了（2.0.5 的滞后接受生效），但删除的路由会复活。机制已用沙箱复现钉死：写入**确实落盘**（patch 与草稿一致），但 describe mirror 在保存后仍返回旧文档，**re-seed 效应用旧值覆盖了刚保存的表单**——被删除的路由此复活。沙箱对照证明：宿主行为正常时路由不复活，复活只发生在 mirror 滞后时。
  修复（两条互补）：
  1. **保存后设「保持」**：re-seed 效应从此只接受与刚保存的表单**一致**的 mirror 值；不一致（滞后）时拒绝用它覆盖表单，杜绝复活。
  2. **后台收敛轮询**：滞后接受后有界地持续重读 mirror（20 次 × 500ms），一旦它与保存值一致即释放保持、恢复正常同步；始终不一致则表单保持已保存的真值（patch 即真值），并在 console 留 warn。
  回归测试两个：mirror 永不收敛时删除不复活；mirror 有限次重读后收敛时，全程不复活且最终同步。

## 2.0.5 (2026-09-26)

### Fixed

- **真机实锤的最终根因：写入成功了，是回读校验把它误报成失败**。带着 2.0.5 的取证报错在真机复现，三条铁证拼出完整图景：
  ① `write=atomic` 且无 `:refused=` —— 原子写入**被宿主接受**；
  ② profile patch 的 mtime 正是点击保存的那一秒，内容与草稿**逐字段一致** —— **写入已落盘**；
  ③ 报错里 `rev=2`（revision 已前进）但 `got=` 仍是旧值 —— describe **mirror 在整个重试窗口内一直返回旧文档**。
  即「已接受的写入 ⟹ 必然落盘」（`configEditor.edit()` 只有在 patch 写盘且 Loader 完成调和后才 resolve；任何失败都会抛错并让 `mutate()` 返回 `false` 走 `:refused=` 路径），而严格六字段回读等值校验把 mirror 的滞后当成了保存失败——这正是 `notApplied:ready:writable=true` 的全部真相。
  修复：**已接受的写入 ⟹ 报告保存成功**，表单从草稿重置；回读重试保留（快速收敛时用存量真值校准），最终仍不匹配时取草稿为真值并在 console 留 warn。原有的 revision-change 重播种效应会在 mirror 追上后把显示收敛到宿主实际保存的内容。

- **revision 栅栏拒绝现在会重试一次**（同一次保存的另一条硬化）。用真实宿主代码复现了机制：`configEditor.edit()` 先 `reconcileProfilePatches()`（重建条目 fiber → revision 由 `entry.fiber.uid` 派生而变化）再做 revision 检查，携带旧 revision 的写入会被 `SettingsConflictError` 拒绝、`ConfigFormController.mutate()` 回 `false`。控制器在返回 `false` 前已调 `recover() → mirror.load()` 折入新鲜 revision，因此**紧接着的重试必然携带正确 revision 并落盘**；第二次仍被拒才报错。同时把一次保存从六次独立 `set()` 合并为**一次原子 `mutate(ops)`**（六个 op 一笔事务、一个 revision）。

### Changed

- **失败报告自带完整取证**：`notApplied` 报错附带 `scope 状态 + writable + mirror revision + 写入路径(atomic/sequential) + 逐字段差异(got/exp)`。正是这套取证让最终根因在真机上一次定位（2.0.4 及之前只有一个笼统的 scope 状态）。
- **设置卡常显 `[diag <build>]` 诊断行**（mirror 状态、绑定命名空间、scope 状态、revision、构建标记）。之前它只在 `!writable || status!=="ready"` 时显示——恰好把最需要它的故障窗口藏掉了。构建标记（`DSM_CLIENT_BUILD`）用于确认页面实际运行的 client bundle；宿主在启动时快照 bundle，排查期间每次修改 client.js 必须递增它。

### Testing

- 全量 **112 项通过**（+4）。新增用例都驱动**真实注册卡片 + 真实 `persistDefaultModels`**（从注入的 slot face 捕获，而非桩），对照一个忠实建模 `ConfigFormController` 语义（拒绝先 `recover()` 折入新 revision、接受即折入新值）的控制器：
  ① **栅栏拒绝被重试一次并落盘**；② 慢 reload 被回读重试等过去，不误报；③ **已接受但回读永不收敛的写入报「已保存」而非失败**（真机根因的回归守卫）；④ 真正被拒的写入报错带 rev / write 路径 / `:refused=` 标记，与回读滞后可区分。

## 2.0.4 (2026-09-26)

### Fixed

- **设置卡片保存永久失败（P0）：插件自带的 schemastery 缺 `.volatile()`，整段设置命名空间被宿主静默丢弃**。用户报告的现象是保存时报
  `本机宿主未为此插件提供设置存储（notApplied:unavailable:writable=false），暂时无法保存；请确认插件已在当前 profile 中启用，然后重启 DSH。`——而该插件确实已启用、宿主也确实在服务它，重启与重装都无法改变。
  根因链条（每一环都已用真实宿主代码验证）：
  1. `@deepseek-ai/dsh-settings` 从 Config schema 派生设置面时调用 `volatileForm()`；**没有任何字段带 volatile 标记时它返回 `undefined`，`describe()` 随即 `return []` 丢弃该条目**——插件因此根本不出现在设置命名空间目录里。
  2. 客户端卡片的 scope 从 describe mirror 的这份目录里解析命名空间；目录里没有它，`servedNamespaceNow()` 永远返回 `null`，scope 永不绑定。
  3. 未绑定的 scope 其快照就是字面量 `{ status: "unavailable", value: undefined, writable: false }`，于是保存走完全程后落到
     `notApplied:unavailable:writable=false`——**这正是用户看到的那句话**。
  4. 标记为何没打上：`volatileField()` 只在 `schema.volatile` 是函数时才调用它，而插件 `node_modules` 里实际装的是 **schemastery 3.18.1**，该版本尚无 `volatile()`（3.18.4 才引入）。`package.json` 声明的是 `>=3.18.4`、lockfile 也钉的是 3.18.4，**实际安装树却是 3.18.1**，于是降级分支的恒等 no-op 被当作正常路径执行。
  修复：`volatileField()` 在 `volatile()` 缺失时回退到 `extra("volatile", true)`——3.18.4 的 `volatile()` 本体就是这一句（外加一个重复标记守卫），故该回退在旧构建上语义完全一致、在新构建上仍走原路径。同时把 `@deepseek-ai/schemastery` 依赖下限由 `>=3.18.4` 放宽为 `>=3.18.1`，因为代码已不再依赖 3.18.4 专有方法。
  证据（`SettingsForms.describe()` 与宿主写入门，均为真实宿主代码，对照 git HEAD 的修复前模块）：
  | | 命名空间是否出现在设置目录 | Save（`mutate`）结果 |
  |---|---|---|
  | 修复前 | **0 个（被丢弃）** | `REFUSED -> Plugin entry "dsh-subagent-default-model" has no volatile fields` |
  | 修复后 | 1 个，字段全部可编辑 | `ACCEPTED`，且落盘分节内容正确 |

- **上一条修好后的第二层故障（同一张卡、另一条根因）：`provider` / `model` / `reasoningEffort` 三个字段在「空分节」下被宿主从设置表单里静默剔除**。第一层修复后，保存报错从
  `notApplied:unavailable:writable=false` 变成 **`notApplied:ready:writable=true`**——scope 已 ready 且可写，写入却「没生效」。
  `@deepseek-ai/dsh-settings` 的设置面由 `projectForm()` 逐字段投影，而它会**丢弃任何解析值为 `undefined` 的字段**：

  ```js
  return field === void 0 ? [] : [[key, projectForm(child, field)]];
  ```

  三个字符串字段当初只写了 `z.string()`、**没有 `.default(...)`**，于是空分节下解析为 `undefined`、整条被剔除。后果是卡片读到的 descriptor 里根本没有这三个键：它写进去、回读时该键不存在，于是判定不一致并抛 `notApplied:ready:writable=true`。**一个表单看不见的字段，就是它既写不了也验不了的字段。**
  修复：三者补上 `.default("")`（空串正是本插件各处既有的「未设置 → 继承父会话路由」语义，`defaultModel()` 判的就是 `length > 0`）。
  **作用范围已精确界定**（两种输入都实测过，不夸大）：
  | 分节状态 | 无 `.default("")` | 有 `.default("")` |
  |---|---|---|
  | **空分节**（首次保存、刚装好） | 缺失 **provider, model, reasoningEffort** | 六个齐全 |
  | 已存过值的分节 | 六个齐全（该键已非 `undefined`，`projectForm` 不再剔除） | 六个齐全 |
  也就是说：本缺陷打击的是**首次保存**（以及任何把这三个键清空的路径）；已经存过值以后它不再发作——这正是它难被发现的原因。用户 14:05 那次报错发生在**已有存值**的状态下，因此主要成因见下一条（回读竞态 / 半写入），本缺陷是同一张卡上独立存在的第二个坑。

- **同一次修复：把「一次保存」从六次独立写入合并为一次原子写入，并让回读等待真正落盘**。这一条解释用户 14:05 的报错（该次写入**确实落盘了**：profile patch 的 mtime 与内容都证明六个字段都写进去了）：
  1. **六次独立事务**——卡片原先对六个字段各调一次 `scope.set()`，每笔各自取一次 `expectedRevision`；而 `configEditor.edit()` 会在写入后重建条目 fiber（`dsh-settings` 的 revision 正是由 `entry.fiber.uid` 派生），链中靠后的字段会被 revision 栅栏挡下、`remote.settings.mutate` 回 `ok:false`、`ConfigFormController.mutate()` 返回 **`false`**——旧代码**忽略了这个返回值**，把半写入当成成功。现优先走单次 `mutate(ops)`（服务端把全部 op 收进**一次** `write()`），原子落盘；控制器无原子形态时回退顺序写入，但**在第一个被拒处即中断**。
  2. **回读竞态**——`edit()` 落盘后 Loader 重建 fiber，mirror 要等这次 reload 提交才看得到新文档；旧代码在写 promise 一 resolve 就立刻读快照判定，于是把「已落盘但回读还是旧值」报成 `notApplied:ready:writable=true`。现改为经 scope 的 `refresh()` **强制重读**并在有界次数内重试，再判定。

### Testing

- 全量 **108 项通过**（原 101 项 + 7 项新增守卫）。
- 新增守卫（`plugin/test/settings-install.test.mjs`）：① 无 `volatile()` 的旧构建上 `extra()` 回退必须**真的打上标记**（而非恒等 no-op 直接返回，那正是缺陷形态）；② 有 `volatile()` 时优先走 `volatile()`；③ 两者皆无的字段原样返回，不在模块求值期炸掉；④ **回归守卫**：遍历真实 `Config` 每个字段断言 `meta.volatile === true`；⑤ **每个字段必须声明 `.default(...)`**，并逐个断言那三个空串默认值；⑥ 以空分节解析 schema、解开 volatile 引用后断言**六个键一个不少**（`projectForm` 判的就是这个）。
- 新增守卫（`plugin/test/client-trajectory.test.mjs`）：⑦ scope 必须提供原子写入 `setMany`，且一次保存只产生**一次** `mutate`、op 为宿主要求的 path-addressed 形态；⑧ scope 必须提供 `refresh()` 强制 mirror 重读（否则「已落盘但回读仍是旧值」会被误报）；⑨ 未绑定的 scope 对 `set` 回 `false`、对 `setMany` 回 **`undefined`（绝不谎报成功）**，快照如实报 `unavailable` / `writable: false`。
- **变异验证**（守卫必须能变红）：把 `.default("")` 从 `provider` 去掉 → 2 项测试变红；把 `extra()` 回退改为死代码 → 2 项测试变红；未变异基线 0 失败。模块在每次变异后**逐字节还原**（已断言）。
- 修复前的 `volatile() absence degrades to an identity field` 用例断言的是**缺陷本身**，已按上述替换。

## 2.0.3 (2026-09-26)

### Fixed

- **Windows 全平台受支持（此前存在只在 Windows 上暴露的硬故障）**：`plugin/test/dependency-integrity.test.mjs` 用 `new URL("..", import.meta.url).pathname` 推导插件根目录。Windows 上文件 URL 形如 `file:///C:/...`，其 `pathname` 为 `/C:/Users/...`，经 `path.join` 折成 `\C:\Users\...`——一个不存在的路径，于是 `readFileSync` 在任何断言执行前抛 ENOENT，**整套测试在 Windows 检出上直接死掉**。该缺陷在 macOS/Linux 上不可见（两种写法结果一致），因此只有 Windows 才会暴露。已改为 `fileURLToPath(new URL("..", import.meta.url))`；后者同时也解析 `%20` 等转义，含空格路径（如 `C:\Users\My Project\...`）一并修好。
  新增两条守卫：① 扫描 `lib/`、`scripts/`、`test/` 全部源码，禁止出现 `new URL(...).pathname` / `import.meta.url.pathname`（先剥离注释，避免守卫自身的说明文字自匹配）；② 断言本守卫文件自身确实使用 `fileURLToPath`。已**变异验证**：在 `test/` 放入一个使用 `.pathname` 的文件后该守卫立刻变红。
- **两个开发脚本在 0.1.7 上启动即崩（与平台无关的既有回归）**：`scripts/simulate-retry.mjs` 与 `scripts/verify-mock-failover.mjs` 仍 `import { SettingsProvider } from "@deepseek-ai/dsh-settings"`，而该命名导出在 0.1.7 线已被删除（当前 0.1.7-rc.2 的导出只剩 `SettingsConflictError` / `SettingsForms` / `default` / `redactSecrets`）。两脚本因此抛 `SyntaxError: does not provide an export named 'SettingsProvider'`，一行断言都没跑到。已改用 0.1.7 的设置模型——把配置段**直接**传给 `apply(ctx, config)`（`root.registry.plugin(plugin, config)`），并把配置段由旧的 `{ "subagent-default-model": { … } }` 嵌套形态改为扁平形态。此改动与 2.0.0 起 `test/` 已采用的范式对齐，属测试脚手架未同步的遗漏。
- **`simulate-retry.mjs` 的客户端桩停留在 0.1.6 契约**：修好导入后随即抛 `TypeError: ctx.effect is not a function`——桩里仍在提供已删除的 `settingsScope` 与 `conversationEvents` 服务，缺少 `ctx.effect` 与 `ctx.inject(["configForms"], …)`。已按 `test/client-trajectory.test.mjs` 的现行桩重写（`configForms` 的 `describe`/`get`、`uiConversation.events.register`）。该脚本现已恢复完整链路输出。
- **`verify-mock-failover.mjs` 的成功路径解析错误**：mock 服务器对成功响应默认走 SSE 流式（DSH 默认请求流式），而脚本用 `res.json()` 解析，得到空对象，最后一条断言必然失败。已按 `content-type` 分流：`text/event-stream` 走 `data:` 帧聚合 `delta.content`，`application/json` 走 JSON 解析。

### Changed

- **`npm test` 改为不带 glob 的 `node --test`**（原为 `node --test test/*.test.mjs`）。glob 由 shell 展开：POSIX sh 会展开，Windows 的 cmd/PowerShell 会**原样传入**，于是同一命令在两个平台语义不同。改由 Node 测试运行器自行发现用例后，两平台行为一致（已验证发现结果与显式 glob 完全相同）。
- **`integration.mjs` / `prove.mjs` 改用 `dirname(fileURLToPath(import.meta.url))`**（原为 `import.meta.dirname`）。后者需 Node ≥ 20.11 / 21.2；本次不提升任何运行门槛。
- **CI 增加 `windows-latest` 与 `macos-latest` 矩阵**（原仅 `ubuntu-latest`）。单一 Linux 任务无法捕获平台路径类缺陷——`new URL(...).pathname` 与 `path.join` 在 POSIX 上一致、在 Windows 上分叉，正是本次修掉的故障类别。
- **README（中/英，根目录 + `plugin/`）新增「平台支持」章节**：明确 Windows / macOS / Linux 三平台受支持，给出三平台配置路径对照表，并列明已检查并持续验证的平台面（依赖树跨平台、CRLF 安全、路径解析、测试发现）。根 README 以表格给出结论，`plugin/README` 给出逐条依据。
- **`DEVELOPMENT.md` 新增「平台影响面」检查清单**：此后每次改动都须复盘八个面（路径解析、路径拼接、shell 依赖、测试发现、换行符、依赖树、进程/信号、大小写），并注明 CI 门禁为持续验证手段；同时勘正文档内 macOS 专属写法（`⌘Q` 补 Windows 退出方式、安装路径补 Windows 形态）。

### Testing

- 全量 **92 项通过**（原 90 项 + 2 项新增跨平台守卫）；`integration.mjs` 与 `prove.mjs` 均通过。
- **CRLF 检出验证**：在整仓按 CRLF 重写的副本上跑全套测试，**92/92 通过**——证明按源码文本做断言的用例不依赖行尾（仓库未固定 `core.autocrlf`，Windows 检出即该形态）。
- **脚本恢复验证**：`simulate-retry.mjs` 输出完整五段链路（失败 → 切换 → 帧追加 → 轨迹渲染 → 对话渲染）；`verify-mock-failover.mjs` 对真实 mock 服务器跑通「真实 429 → 插件切换 → 真实 200」全链路。
- **平台守卫变异验证**：向 `test/` 放入使用 `.pathname` 的文件 → 守卫变红并指名该文件；移除后复绿。

## 2.0.2 (2026-09-25)

### Fixed

- **对话流里的「当前/切换/恢复模型」上下文行不可见（P0）：0.1.7 宿主把内置 `context` kind 行从可见对话流里过滤掉了**。`lib/client.js` 的 `chatModelDefinition` 原本写成 `kind: "context"`，复用宿主内置注入行。但 `dsh-client-ui-chat` 的可见性规则 `isVisibleChatNode()` 硬排除 `node.kind === "context"`（注释明写「Exclude system prompts, ordinary Context …」），且分类逻辑对插件注入消息直接归为 `context`。结果：轨迹里能看到那一行，但**对话流主视图里永远不出现**——用户可感的正是「切换/恢复模型提示消失」。
  已把节点 `kind` 改为**自有值** `chat-subagent-model-notice`（`CHAT_MODEL_NODE_KIND`）。该可见性黑名单只列 `system-prompt` / `context` / `permission` 三项，自定义 `kind` 默认可见；`source.kind`（消息来源标识，仍是 `plugin:dsh-subagent-default-model`）与节点 `kind` 是两件事，保持不动。
  注意：光改 `kind` **不够**。宿主按 `entryKey = node.kind` 在 `conversation.chat.node` 这个 **keyed 槽位**运行时分派渲染器；没有占用者的 `kind` 会落到 `ChatNodeSeat` 传入的 `fallback`——一个 `JsonBlock`（标签「unknown surface」+ 节点数据原样 JSON）。也就是说，不配渲染器的话，不可见会变成**对话流里出现一行原始 JSON**，比不可见更糟。
  故同步新增自有渲染器 `SubagentModelNoticeRow`（经 `registerSubagentModelNotice()` 注册到 `conversation.chat.node`，`key: CHAT_MODEL_NODE_KIND`，并声明 `locale:` 以收到字典）：折叠态只显示行头（圆点 + 「上下文注入 · dsh-subagent-default-model」+ summary），点开才渲染 `<pre>` 完整内容；新增 `.dsm-notice-*` 样式与 zh/en 的 `row.noticeLabel`；`trajectory` 侧不受此影响（该黑名单只在 ui-chat）。
  旧注释曾写「复用内置注入行（ContextMessageNodeView）」——其复用目标在 0.1.7 已不存在，已一并勘正。

### Testing

- 新增 3 个契约用例（`plugin/test/client-trajectory.test.mjs`）：① `buildViewNode` 产出的 `kind` 必须是自有值、绝不能是宿主的 `"context"`，且 `source.kind` 保持 `plugin:dsh-subagent-default-model`；② `conversation.chat.node` 槽位恰好注册一个渲染器、`key` 必须等于节点 `kind`、组件必须是函数；③ 渲染器表现——折叠态只显示 summary、不挂载 `<pre>`，点击 toggle 后展开出完整文本且 `aria-expanded` 跟随，并对缺 `content`/`summary` 的节点容错不抛错（此时标签退化为字典 key）。
- 因 `slotRegistrations` 不再只含两张设置卡（又多了聊天渲染器），把原先按位置索引 `slotRegistrations[0]` 的断言改为 `cardRegistrations()` 按槽位名（`plugins.`）过滤，避免断言错认贡献。
- 均**变异验证**过：把 `kind` 改回 `"context"`、或把渲染器注册删掉，上面三条立刻变红，还原即全绿。全量 **90 项通过**。

## 2.0.1 (2026-09-25)

### Fixed

- **设置卡的「保存」按钮永久灰着、点不动（P0）：命名空间在 `apply` 期只探测一次，落空后永不重探**。`lib/client.js` 原本写作 `subagentScope = forms.get(subagentEntryIdOf(forms))` —— 一次性的 `get()`。但 `configForms` 的 describe mirror 是**异步加载**的（`mirror.ensure()`），`apply` 跑的时候 `view` 往往还不存在；此时 `subagentEntryIdOf` 看不到任何命名空间，只能回落到**声明条目 id** `dsh-subagent-default-model`，而桌面宿主实际服务的是 **`include:dsh-subagent-default-model`**。
  绑定错命名空间后，宿主的 `ConfigFormController.derive()` 找不到对应 `view`，把表单停在 `status: 'unavailable'`（**静默，不报错**），而 `derive()` 只在 mirror 变化时重跑——**而作用域早已被捕获，于是永远停在 unavailable**。卡片的 `saveDisabled` 含 `snap.status !== "ready"`，因此保存按钮**永久禁用**；同时因 `value` 为 undefined，卡片还会退化成「尚未指定默认模型」的空态。
  已改为 0.1.7 的官方范式 **`configForms.whileServed([...], (served) => …)`**：命名空间**进入 mirror 时**才注册贡献，并把宿主实际服务的命名空间集合交给回调，据此解析并绑定；命名空间消失时自动卸载贡献。`subagentEntryIdOf(forms, servedNamespaces)` 现优先使用该集合（它正是判定「该注册了」的依据，mirror 可能仍在折叠中），mirror 快照退居其次。
  这是 `remote.session` 那条的**同类第三次**：**「取一次就捕获」在异步就绪的服务上必然出错**。
  诊断与验证（不依赖 Electron）：以宿主 `derive()` 的真实语义构造两类作用域，渲染同一张卡片并触发改动 —— 正确绑定（`ready`）→ `Save disabled = false`（可保存）；错误绑定（`unavailable`）→ `Save disabled = true`（永久禁用）。修复前用一次性 `get()` 恰是后者。

### Testing

- 新增 1 个 **行为级**用例 `cards bind to the namespace the host actually serves when the mirror is late`：mirror 为空时 `apply` 必须**不**绑定任何命名空间、**不**注册卡片；待宿主服务的命名空间出现后，绑定必须落在 `include:<条目 id>` 上并注册两个放置点。
- 改写 `resolves the served settings namespace instead of assuming the bare id`，使其断言 `whileServed` 契约（含 `servedNamespaces.has` 优先与逐次绑定），而不再固定旧的一次性 `get()` 形状。
- 两者均**变异验证**过：把实现改回「`apply` 期一次性探测」后立刻变红，还原即全绿。全量 **86 项通过**。

## 2.0.0 (2026-09-25)

### Breaking

- **宿主最低版本提升至 `@deepseek-ai/dsh >= 0.1.7-rc.1`**（peer 区间收窄为 `>=0.1.7-rc.1 <0.2.0`，全部 8 个 `@deepseek-ai/*` peer 一致）。0.1.7 线删除了本插件此前依赖的三处契约：`@deepseek-ai/dsh-settings` 的 `installSettingsSection` / `settingsNamespace` 命名导出、客户端 `settingsScope` 服务与 `settings.plugin.item` 槽位。依据同族插件 `dsh-ldvh` 的同源调研。

### Changed

- **设置接入迁移到 0.1.7「插件 Config 即设置」模型**：`lib/index.js` 导出 `Config`（字段逐个 `.volatile()`），移除对 `@deepseek-ai/dsh-settings` 的**命名导入**——该导入在 0.1.7 上会导致模块链接期失败、整个宿主插件无法装载，且因 peer 区间「覆盖了该版本」而不会被版本检查拦下（**范围覆盖 ≠ 符号仍存在**）。写入改走 profile patch（经宿主 `configEditor`）。
- **客户端设置面迁移**：硬注入 `settingsScope`（0.1.7 已删除，会让整个客户端插件永不 apply）改为仅硬注入 `slots` / `locale`，`configForms` 改软注入；设置卡从已删除的 `settings.plugin.item` 迁到 `plugins.bundle.config` 与 `plugins.row.config` 双注册。
- **设置卡对齐同族范式**：`view: 'page'` 默认展开、`view: 'summary'` 只渲染一行描述，展开/收起按钮补 `aria-label`。
- **`dsh-client-ui-primitives` 图标族适配**：尺寸数字后缀（`…Outline14`）→ 粗细语义后缀（`…OutlineRegular` / `…Medium`），改为按名探测取第一个可用者并在渲染点兜底——把宿主改名造成的渲染期**硬崩溃**降级为视觉降级。

### Fixed

- **宿主整体装载失败（P0）：依赖树指向已被删除的 `/Applications/DSH Desktop.app`**。`plugin/node_modules/@deepseek-ai/` 下的 `schemastery` / `cordis` / `dsh-settings` 三个条目是**指向旧应用包的符号链接**；应用换成 `DSH NEXT.app` 后这些链接全部悬空，`lib/index.js` 第一行的 `import z from "@deepseek-ai/schemastery"` 直接 `ERR_MODULE_NOT_FOUND`。宿主表现为 `dsh-subagent-default-model (dsh-subagent-default-model): failed to import`，插件**一行都没跑**——而 `npm test` 仍全绿。已删除悬空链接并以 `npm install` 重建为真实目录。判据：`find node_modules -maxdepth 3 -type l ! -exec test -e {} \; -print` 必须为空。
- **devDependency 精确锁定致 `npm install` ERESOLVE**：`@deepseek-ai/dsh-settings` 写死 `0.1.7-rc.1`，而它自身 peer 依赖 `@deepseek-ai/dsh-brand@0.1.7-rc.1`，该包只发布了 `0.1.7-rc.2`，于是干净安装直接失败。这正是本仓 CHANGELOG **1.2.2 已经记过的那条教训**（「此处必须用范围而非精确锁定」）——被 0.1.7 适配时的版本推进重新踩了一次。已改为 `^0.1.7-rc.1`。
- **旧 `settings.yaml` 配置不会随 0.1.7 迁移过来**：0.1.6 及更早，本插件把配置注册为 `~/.dsh/settings.yaml` 的 `subagent-default-model` 段。0.1.7 起该文件在启动时被**一次性导入并改名**为 `settings.yaml.imported`（改名先于首次写入，所以部分导入永不重试），导入按段名**直接当条目 id** 使用，而本插件的条目 id 是 `dsh-subagent-default-model`——于是该段导入失败，宿主日志留 `section subagent-default-model … was not imported into entry subagent-default-model`，`profile/cordis.patch.yml` 里始终没有本插件的 `config:`。**本机实测命中**：旧值仍在 `.imported` 文件中，需手工搬进 profile patch。README / DEVELOPMENT.md 已改为描述 0.1.7 的真实存储位置并写明该陷阱（原文档仍在教用户编辑 `~/.dsh/settings.yaml`）。
- **设置保存必然失败（P0）**：`Config` 未声明 `reasoningEffort`，而设置卡的保存路径每次都写入该键。宿主 `@deepseek-ai/dsh-settings` 的 `write()` 对每个写入路径执行 `Config field "…" is not volatile` 门禁，因此**任何一次保存都被拒绝**——不只是改推理强度，而是整张设置卡存不进去，且界面只显示笼统的「保存失败」。已把 `reasoningEffort` 补为声明字段并标记 volatile；`getSection()` 同步读回该键，否则单模型形态配置的推理强度会被静默忽略。
- **设置卡可能绑定到无人服务的命名空间**：0.1.7 的 `configForms.get()` 对宿主 served-namespace 目录做**精确匹配**，而桌面宿主以 `include:<包名>` 挂载 Loader 条目。绑定错误时 `status: unavailable`、**静默失效不报错**（同 `dsh-ldvh` abb35db、`dsh-connect-workbuddy` 2.0.16 修掉的同一类坑）。现抽为具名 `subagentEntryIdOf(forms)`，按「声明条目 id → `include:<条目 id>` → 包名子串」的顺序匹配，仅在 mirror 未就绪时回落到声明 id。已用真机命名空间 `include:dsh-subagent-default-model` 做端到端绑定验证。
- **回落常量取的是已退役的 0.1.6 段名**：`SUBAGENT_MODEL_SETTINGS_NS` 原为 `"subagent-default-model"`，那是 0.1.6 及更早 `settings.yaml` 独立设置模型里的段名；0.1.7 起命名空间**就是 Loader 条目 id** `"dsh-subagent-default-model"`。mirror 未就绪时按旧名回落会绑定到无人服务的命名空间。已改为条目 id；`lib/index.js` 中被遗留的同名常量（仅声明、从未使用）一并删除——宿主而非插件拥有「条目 id ↔ 命名空间」的映射，插件不该保留第二份。
- **图标回退分支无样式**：`IconChevronDown` 探测全缺失时渲染 `.dsm-plugin-card-caret` 字形，但该类**只有使用点、没有 CSS 规则**。已补规则，并加守卫用例禁止「渲染了却无规则」的类再次出现。
- **设置卡的 Provider / Model 下拉永远为空（P0）：`remote.session` 是异步挂载的服务，插件却在 `apply` 时只取一次**。`lib/client.js` 原写法 `var sessionRemote = ctx.get("remote.session")` 把叶服务**捕获**进变量；而该服务由网关的**异步** `remote.$mount()` 注册（`packages/api/gateway/src/client/index.ts`：`remoteServiceKey(ns)` → `remote.<ns>`，挂载点在 `async $mount` 内）。`apply` 跑的时候网关通常还没挂完 → 捕获到 `undefined` → `loadCatalog` 从此恒返回空数组，**而且因为值是捕获的，之后挂载完成也永远不会重取**。表现就是设置卡能打开、两个下拉却没有任何可选项。
  已改为**每次调用时懒探测**（先 `ctx.get("remote.session")`，再退回 `ctx.get("remote")?.session`），晚到的挂载即可被拾取；网关始终缺失时仍降级为空下拉且不抛错。官方同功能卡片（`ui-settings-subagent`）是把 `'remote','remote.session'` 写进 `inject` 让 Cordis 等待；本插件保持软注入（网关缺失不该扣下整张卡），因此改用重探测达到同样效果。
- **同族坑：`ctx.get()` 不按点号拆分**。Cordis 的 `get(name)` 是整串查表（`this.ctx[symbols.isolate][name]`），`"remote.session"` 之所以成立，是因为网关真的以这个字面量注册了服务（`remote.${namespace}`），不是 `remote` 的嵌套属性访问。所以「带点的服务名」能否解析，只能以**是否有人注册过该整串**为准——按「父对象.子属性」去推断会得到错误结论。
- **Plugins 详情页整块没有配置区（P0）：读取未在 `inject` 声明的服务会抛错，把 `apply` 后半段整段打断**。`lib/client.js` 用 `if (ctx.uiConversation && ctx.uiConversation.events && …)` 这种「守卫写法」读 `ctx.uiConversation`，而它**没有**出现在 `inject` 里。Cordis 对未声明的服务**不返回 `undefined`**，而是抛 `cannot get property "uiConversation" without inject`（Cordis `lib/index.js` 的 service accessor；已用真实 `new Context()` 复现）。因此那个 `&&` 守卫**完全无效**——求值 `ctx.uiConversation` 本身就是抛错点。
  致命之处在于位置：该读取位于 `apply()` **中段**，它一抛，**其后**的 `ctx.inject(["configForms"], …)` 整块——也就是注册设置卡的那段——再也不会执行。于是详情页连配置区外壳都不出现（宿主只在 `ledger.bundles.has(包名)` 时才渲染该区块），且宿主日志只留一行、没有栈。
  已把 `uiConversation` 加进 `inject`（与官方全部 7 个消费者一致：ui-chat / ui-plan / ui-deliverables / ui-open-in-app / ui-settings-account / ui-settings-models / ui-model-selection）。`configForms` 仍走软注入——它本身是可选的，且 `ctx.inject` 正是「等它就绪而不抛错」的 API。
- **同族坑：`ctx.<service>` 的读取必须声明，`ctx.get()` 才是无声明探测**。前者抛错、后者返回 `undefined`。凡「想可选地用一个服务」只能走 `ctx.get` / `ctx.inject`；写成 `if (ctx.foo && …)` 不但拦不住，还会把 `apply` 打断在最坏的位置。
- **「当前供应商/模型」上下文行不再出现（P0）：0.1.7 适配时把 `uiConversation` 从 `inject` 里误删，导致每次 `apply` 都在读它时抛错**。对照本仓 HEAD 可见演进：适配前是 `["slots","locale","settingsScope","remote","remote.session","uiConversation"]`，适配后只剩 `["slots","locale"]` —— `uiConversation` **不在 0.1.7 的删除清单里**（被删的是 `settingsScope`），属误伤。而本轮 §「未声明服务读取会抛错」已证明：读未声明的服务是**抛错**而非返回 undefined，于是 `apply` 在第 610 行中断，其后两个 `events.register` 与设置卡注册全部不执行——用户可感的正是**「切换模型/当前模型的上下文提示消失」**。已把 `uiConversation` 加回 `inject`。
- **同族坑：`ConversationEventRegistry.register` 对重复 `kind` 抛错，必须包进 `ctx.effect`**。我们把两个 conversation 定义**裸调**注册且丢弃 disposer（`conversation Definition "<kind>" is already registered`）。Cordis 在替换 fiber 时会再次执行 `apply`，第二次注册即抛错——修复 `inject` 后它仍会中断 `apply` 后半段（含设置卡）。官方全部消费者（`ui-plan`、`ui-deliverables` …）都写作 `ctx.effect(() => ctx.uiConversation.events.register(def), '…')`，让 Cordis 在重挂前先释放。已按该范式包裹两处。
  注意：**多定义 `match` 同一事件是设计允许的**——`assembler.dispatchInput` 会遍历**所有**定义并逐个 `accept`，不是「先到先得」。因此本插件的 `request/header` 定义与官方 `ui-trajectory` 的同名匹配**不冲突**，可见性问题与匹配竞争无关。
- **客户端半边整体不激活（P0）：`apply` 重复执行时命中宿主 locale 重名抛错**。`lib/client.js` 的 `apply` 在函数最开头无条件调用 `ctx.locale.register("settings.subagentModel", …)`，且**丢弃返回值**。宿主 `@deepseek-ai/dsh-client-locale` 对「命名空间已有该语言」是**抛错**（`locale namespace "…" already has locale "…"`），而 Cordis 在 fiber 被替换时会再次执行 `apply`——于是第二次 apply 在注册设置卡**之前**就抛错。宿主表现为 `web boot: 1 entry did not activate` / `dsh-subagent-default-model: failed`，客户端半边**全部贡献**（设置卡、轨迹行、对话行）都不注册，且宿主日志只留一行，没有栈。
  已按同族 `dsh-ldvh` / `dsh-sub-cli` 的范式把登记包进 `ctx.effect(...)` 并**接住两个 disposer**：Cordis 在重挂前会先释放上一次登记，重入即从干净命名空间开始。
  复现与验证方式（不依赖 Electron）：以真实 `locale` 语义（重名抛错）+ Cordis 语义（effect 在重挂前释放）构造 stub，连跑三次 `apply` —— 修复前 `#1:OK #2:THREW #3:THREW`，修复后 `#1:OK #2:OK #3:OK`。
  **这一条是被「测试全绿」掩盖的第三个 P0**：原测试的 `locale.register` stub 只做字典合并、从不抛错，所以永远测不出只对第一次 apply 成立的登记。

### Notes

- **`npm test` 全绿不能证明宿主能装载**：测试与宿主走的是两条不同的模块解析路径（测试从 `plugin/` 解析，宿主从 profile 经软链解析）。本轮三个 P0 里有**三个**在测试全绿的情况下依然让插件完全不可用。宿主编译期的唯一判据是**真正 import 一次**：`cd ~/.dsh/profiles/<profile> && node --input-type=module -e 'import("<包名>")'`。
- **stub 比被测代码宽松时，测试会给假绿灯**：`locale` 那条 P0 的根因就是 stub 省略了宿主唯一的失败路径（重名抛错）。写 stub 时应**先读宿主实现**再决定放行什么——本次是照 `dsh-client-locale/lib/client.js` 的重名抛错逐字建模后，才复现出来。
- **客户端半边是否真的激活，要按 `failed` / `pending` 区分**：两者都表现为「插件在 Web 上不见了」，但机制相反——`pending (waiting for service: …)` 是硬注入了一个不存在的服务（apply 因为等不到服务而从未运行）；`<id>: failed` 是 apply **跑了但抛错**。查证入口是 `~/Library/Logs/DeepSeek Harness/crash-*-web-boot.log`，它同时给出判据行与 renderer console。
- **改完 `node_modules` 后，已在运行的宿主进程不会重新 import**：它把失败状态留在内存里，`plugin_manager` 反复 enable/disable 都返回同一个 `failed to import`，且不再写新日志。验证修复必须**重启应用**，而不是重试开关。


### Docs

- **安装入口改写**：`dsh plugin --profile desktop add <path>` 在新版桌面壳上会被拒绝（`profile "desktop" is managed exclusively by the Electron application`）。DEVELOPMENT.md 改为走 DSH Desktop 内插件管理 / `plugin_manager` 的 `install_bundle`（target = 插件包绝对路径），并补上三条安装后核对（bundle 列表、软链、`listConfigs` 条目 id）。
- README（中/英，根与包内）配置示例从 `~/.dsh/settings.yaml` 段改为 profile patch 的 `config:` 块，并写明旧文件的一次性导入与段名不匹配陷阱。


### Testing

- `plugin/test/client-trajectory.test.mjs` 新增 5 个契约用例：服务命名空间必须经 `subagentEntryIdOf` 解析且不得裸调 `get(声明id)`、`include:` 前缀命名空间下必须绑定到宿主实际服务的那一个、回落常量必须是 Loader 条目 id 而非遗留段名、`page` 形态默认展开 / `summary` 形态只渲染一行、全部渲染类都必须有 CSS 规则；另加匹配优先级用例（宿主同时服务 `include:<条目id>` 与遗留段名时，精确匹配必须胜出）。
- 新增 `plugin/test/dependency-integrity.test.mjs`（3 项）——把本轮两个 P0 变成测试能拦住的回归：① 依赖软链不得悬空（`lstatSync` 是链接但 `existsSync` 为假即失败）；② 声明的 runtime dependency 必须在 `node_modules` 里存在；③ devDependency 不得是精确预发布锁定（`^\d.*-` 即失败）。两条守卫都用**变异验证**过：重新造一个悬空链接、把 `dsh-settings` 改回 `0.1.7-rc.1`，各自都被对应用例抓住。
- 全量 **85 项通过**（原 63 项 + 设置/图标契约 5 项 + 依赖完整性 3 项 + `apply` 重入契约 3 项 + 模型目录契约 3 项 + 服务声明契约 2 项 + 会话行注册契约 2 项 + 其余 4 项）；`node integration.mjs`（8 项）与 `node prove.mjs`（1 项）同样通过。
- 新增 2 个 **会话行注册契约**用例（`plugin/test/client-trajectory.test.mjs`），针对「上下文提示消失」：① 用一个**重复 `kind` 即抛错**的注册表 stub 模拟宿主语义，断言三次 `apply`（中间执行 fiber teardown）都能把两个定义重新登记上去——修复前第二次即抛 `already registered`；② 静态守卫，要求两处 `ctx.uiConversation.events.register` 都必须写成 `ctx.effect(function () { return ctx.uiConversation.events.register(…) })`。
  同样用**变异验证**过：把两处改回裸调后，上述 2 条立刻变红，改回即全绿。
- 新增 2 个 **服务声明契约**用例（`plugin/test/client-trajectory.test.mjs`），其中一个用**真实 Cordis**（`new Context()` + `root.plugin({ inject })`）跑 `apply`，断言它必须**正常完成**而不是在未声明服务的读取处抛错——这正是「详情页没有配置区」的根因所在。另一个是静态守卫：把客户端源码去掉注释后，凡 `ctx.<service>` 形式的**属性读取**都必须出现在 `inject` 里。
  同样用**变异验证**过：把 `uiConversation` 从 `inject` 拿掉后，上述 3 条（含真实 Cordis 那条）立刻变红，加回即全绿。
- **跨 realm 断言注意**：客户端工厂由 `new Function` 执行，其数组带的是另一个 realm 的 `Array.prototype`，对两个「内容相同但来源不同」的数组用 `assert.deepEqual` 会误报失败（`actual: []` / `expected: []` 却判不等）。相关用例改用 `assert.equal(arr.length, …)` 比较。
- 新增 3 个 **模型目录契约**用例（`plugin/test/client-trajectory.test.mjs`）：① `remote.session` 在 `apply` **之后**才挂载时，`loadCatalog` 必须重探测并取到目录；② 网关**始终缺失**时降级为空数组且不抛错；③ 守卫 `apply` 不得把 `remote.session` 捕获进变量（防止这个 bug 以任何形式复发）。
  同样用**变异验证**过：把 `loadCatalog` 改回「`apply` 时一次性捕获叶服务」的原始写法后，①③ 立刻变红，改回修复版即全绿。
- **跨 realm 断言注意**：客户端工厂由 `new Function` 执行，其数组带的是另一个 realm 的 `Array.prototype`，对两个「内容相同但来源不同」的数组用 `assert.deepEqual` 会误报失败（`actual: []` / `expected: []` 却判不等）。这两条用例改用 `assert.equal(arr.length, 0)` 比较。
- 新增 3 个 **`apply` 重入契约**用例（`plugin/test/client-trajectory.test.mjs`）：① 以真实 `locale` 语义（重名抛错）连跑三次 `apply`，每次先释放上一 fiber 的登记，三次都必须干净登记；② 显式记录边界——宿主若**不**先释放就重挂，仍会抛 `already has locale`（所以登记必须留在 `ctx.effect` 内）；③ 断言 locale 登记确实被 `ctx.effect` 包住（否则 Cordis 无从释放）。
  这 3 项同时用**变异验证**过：把 `lib/client.js` 改回「无条件登记、丢返回值」的原始写法后，①③ 立刻变红，改回修复版即全绿。
- P0 已用**宿主门禁的独立复现**验证：对适配前的 5 字段 `Config` 跑宿主 `isVolatilePath`，`reasoningEffort` 判定为 `not volatile` → 写入抛错；补上该字段后 6 个写入路径全部通过。
- 宿主接缝已逐项在**运行时目录**核对（不是只搜源码）：`agent/request-error`（waterfall）、`agent/request`（waterfall）、`agent/disposed`（emit）三者均存在；已删除的 `agent/session-start` 未被本插件引用；`subagents` 服务的 `start` / `startContinuable` 签名与包装点一致。

## 1.3.0 (2026-09-22)

### Features

- **设置面板预检 `reasoningEffort` 是否被目标模型声明，不匹配时给出红字警告**：当所配 effort 不在目标模型当前声明的 `reasoning.efforts` 内（或该模型**根本没有声明任何 effort**）时，在该路由行内与保存区各显示一条警告，指明具体缺失的档位。选中即时校验，声明补齐后警告自动消失；**保存不被阻止**——供应商目录可能尚未刷新，卡住保存会把用户困在一个暂时性的状态里。
- **警告文案区分「模型未声明任何推理强度」与「未声明指定档位」两种情形**，后者会把档位名插值进文案（`{effort}`）。

### Fixes

- **不再让「effort 不被支持」这类配置错误静默表现为「子代理没有任何上下文」**。此前：所配 effort 不被目标模型接受时，宿主在 `prepareRequest()` 阶段就抛 `UNSUPPORTED_REASONING_EFFORT`，**早于** system prompt 组装与上下文注入，也**早于** `agent/request-error` 瀑布派发。子会话因此只有 11 个事件、`request/header` 与 `system/message` 均为 0——界面上表现为「这个子代理里什么都没有」，父会话只收到一句 `failed before it finished / It left no closing message`；真实错误码只落在会话日志里。实测对照：同一路由在声明补齐后连续 3 次成功（descriptor 逐字一致），确认其成因是**上游供应商目录的能力声明在时间窗口内缺失**，而非本插件注入有误。本插件的确定性缺陷是**从不校验**：`reasoningEffort` 在 schema 层仅校验为字符串，因此界面能选出的值与运行时能接受的值可能在窗口期内不一致。本次在设置面板补上该校验。

### Testing

- `plugin/test/client-trajectory.test.mjs` 新增 13 个用例（9 个纯函数契约 + 4 个面板渲染）：覆盖「声明命中不报」「声明缺该档位报并插值档位名」「模型完全未声明 effort 报」「未配置 effort 不报」「未知 provider/model **不报**」「空 efforts 数组等同未声明」「畸形 catalog 与不完整路由不抛异常」，以及渲染侧断言警告节点确实进入组件树、文案插值已解析（非字面量 `{effort}`）。
- 保守方向**是**被测试保护的：把「未知模型」也判为不支持会同时打挂两个用例（纯函数与渲染各一），已用该变异验证。
- 渲染用例驱动**真实注册的卡片组件**（经 hook 感知的 React 替身展开子组件）而非直接调用纯函数，否则接线丢失不会被发现；已用「让检查返回 null」的变异验证其可捕获性。
- 全部 61 项测试通过（原 48 项 + 新增 13 项）。

## 1.2.3 (2026-09-16)

### Fixes

- **故障转移切换到目标模型时，补上目标条目自己声明的 `reasoningEffort`**：`agent/request` 缝合处原本把继承来的 `reasoningEffort` 丢弃后**不再补值**，于是切换过去的请求仍带着上一条路由的 thinking 模式。对于「thinking 档位必须与 effort 一致」的 provider（pi-ai / anthropic-messages 一类），这会直接返回 `400 invalid thinking type, only be disabled when reasoning effort is none and enabled when reasoning effort is not none`。实测中该错误码为 `INVALID_REQUEST`、**不在**触发列表内，因此**不可重试**：故障转移把池子里所有候选逐个消耗在这个永远不可能成功的请求上，子代理最终失败——**尽管池中配置了健康模型**。现在目标条目声明了 effort 就用它；未声明时保持 `undefined`，由 adapter 解析该模型自身的 `defaultEffort`（或整个省略 reasoning 选项），不再继承目标可能不支持的上游档位。
- **故障转移不再重复选中本次运行已经切换过的池条目**：原 `nextFailoverIndex` 仅按 `count` 计数前进，不记录已尝试项；当无法从 `agent.session.requestContext()` 定位当前路由时（`found < 0`）直接回到 index 0，可能切回刚失败的模型或重复选同一个坏候选，白白消耗配额。现在按 `agent.id` 记录本次运行已切换到的索引集合并跳过它们；仅当全部条目都已尝试（或每次切换都失败）时才回落到普通轮询前进。

### Testing

- `plugin/test/failover.test.mjs` 新增两个回归用例：`applies the target entry's own reasoning effort when switching models`（断言切换产物为 `{ provider: "zzztoken", model: "deepseek-v4-pro", reasoningEffort: "max" }`）与 `does not re-select a pool entry this run already switched to`（三条目池，断言第二次切换落到未尝试过的条目）。前者已用回退验证确认可捕获原缺陷（回退实现即失败），不可静默回退。
- 为已有用例 `drops inherited reasoning effort when switching models` 补充注释，说明其断言仅适用于目标条目**未声明** effort 的情形，避免与新增用例的语义混淆。
- 全部 48 项测试通过（原 46 项 + 新增 2 项）。

## 1.2.2 (2026-09-10)

### Fixes

- **修复 peer 区间不接纳 DSH 0.1.5-rc.1（桌面 2.0.9 捆绑内核）**：原区间 `^0.1.0-rc.6 || ^0.1.1-rc.2 || >=0.1.2-alpha.1 <0.2.0` 在语义化版本预发布规则下**不匹配 `0.1.5-rc.1`**——一个预发布版本只有在同一比较器集合中存在**相同 `major.minor.patch` 元组**且带预发布标识的比较器时才可能被接纳；`>=0.1.2-alpha.1` 的元组是 `0.1.2`，无法为 `0.1.5` 承载预发布。实测在宿主已装 `0.1.5-rc.1`（即 DSH Desktop 2.0.9 的实际运行环境）时，npm 抛 `ERESOLVE overriding peer dependency` 并不满足警告，pnpm/严格模式与依赖审计同样判定不符。新增 `>=0.1.5-alpha.1 <0.2.0` 子句为 0.1.5 线提供同元组承载后，0.1.5-alpha.1 / alpha.2 / rc.1 / rc.2 全部被接纳，同时仍排除 `0.2.x`。
- **devDependencies 基线推进到 0.1.5 线**：`@deepseek-ai/dsh-settings` `0.1.2-rc.1` → `^0.1.5-rc.1`。此处**必须用范围而非精确锁定**：`dsh-settings@0.1.5-rc.1` 自身 peer 依赖 `@deepseek-ai/dsh-brand@^0.1.5-rc.1`，而该包当前只发布了 `0.1.5-rc.2`（`next` 通道），精确锁定 rc.1 会直接 ERESOLVE 装不上。这也印证了内核 0.1.5 线已进入 rc.2 迭代、不宜写死补丁版本。

### Testing

- 新增 `plugin/test/peer-range.test.mjs`：从 `package.json` 读取真实 peer 区间做契约回归，自带预发布感知的 semver 判定（已与官方 `semver` 对 12 个版本逐一比对一致）。断言覆盖：所有 peer 均带 0.1.5 元组承载子句；0.1.0-rc.6 起的全部受支持版本可被接纳（含 `0.1.5-rc.1` 这一回归点）；`0.2.x` 仍被排除；并显式复现原区间拒绝 `0.1.5-rc.1` 的缺陷，使该问题不可静默回退。
- 全部 46 项测试在真实 `0.1.5` 线依赖上通过（含 default-model / failover / settings-install / client-trajectory 集成用例）。

### Compatibility

- 保留对旧宿主的支持：`^0.1.0-rc.6`、`^0.1.1-rc.2`、`>=0.1.2-alpha.1 <0.2.0` 三个原有子句逐字保留，未收窄任何既有可装区间。
- 生成器路径自动选择（`installSettingsSection` 在场则委托、否则走 `settings.installSection` 官方缝）未改动；`0.1.5-rc.1` 捆绑包中两种导出与官方缝均在场，两条路径均可用。

## 1.2.1 (2026-09-06)

### Fixes

- **适配 DSH 0.1.2-alpha.2+ 的 dsh-settings 结构变更**：设置段注册迁移到官方 `settings` 服务缝（`ctx.inject(["settings"], …)` → `settings.installSection`）。`@deepseek-ai/dsh-settings` 自 0.1.2-alpha.2 起移除了独立的 `installSettingsSection` / `settingsNamespace` 导出——纯净 npm cohort 宿主（`@deepseek-ai/dsh` CLI、直跑 `dsh web`、CI）上旧导入会直接模块加载失败；此前仅靠 DSH Desktop 的过渡兼容补丁续命。按模块导出有无自动选择路径：仍有旧导出（0.1.0-rc.6 / 0.1.1-rc.2 / 桌面补丁版）走旧助手，否则走官方缝，声明的 peer 区间 `^0.1.0-rc.6 || ^0.1.1-rc.2 || >=0.1.2-alpha.1 <0.2.0` 全程可装。
- **对话视图跳过 `request/header` 的 `series` reason**：DSH 0.1.2 在后续轮开启新请求系列且配置未变时追加 `reason:"series"` 帧；插件不再为其生成行，避免多轮（continuable/steer）子代理每轮多出一行冗余的「当前供应商/模型」。`initial` / `change` / `resume` 三种提示行为不变。

### Testing

- 新增 `plugin/test/settings-install.test.mjs`：安装路径决策单测（旧助手在场→逐字委托；缺席→官方缝、消费者 ctx 保持 section owner；模块缺失→缝兜底）。
- devDependencies 升级：`@deepseek-ai/dsh-settings` `0.1.0-rc.6` → `0.1.2-rc.1`（纯净版，无旧导出），`@deepseek-ai/cordis` `^4.0.1` → `^4.0.2`——现有 default-model / failover 集成测试现在端到端运行真实官方缝路径。

## 1.2.0 (2026-09-01)

### Features

- **适配 DSH 0.1.2 客户端模型目录接口**：设置卡模型目录从已移除的 `connection.api.llm.models()` 迁移到 `remote.session.modelCatalog()`，继续支持供应商、模型与推理强度下拉选择。
- **设置卡正常路径回归测试**：新增真实 Client bundle 沙箱测试，验证 `settings.plugin.item` 注册、`subagent-default-model` key、Client inject 声明以及 `modelCatalog()` 成功响应解析。

### Fixes

- **恢复插件设置卡显示**：补齐 Client bundle 依赖声明，并将设置卡的运行时服务依赖调整为 `remote.session`，避免旧 API 导致 Plugins 标签页渲染失败。
- **设置注册不再等待 subagents 服务**：Host 设置 namespace 独立注册；`subagents` 服务出现后再安装默认模型包装器，避免服务挂载顺序导致设置卡消失。
- **刷新设置 namespace 目录**：Client 卡片注册后主动刷新 `settingsScope.describe()`，避免社区插件晚注册时被设置页初次读取遗漏。
- **适配 `uiConversation` 服务名**：轨迹和对话模型提示改用 DSH 0.1.2 的 `uiConversation.events` 注册入口。

### Compatibility

- 扩展 `@deepseek-ai/*` peer 范围以覆盖 DSH `0.1.2-alpha.1`，Client peer 均保持 optional，不阻塞独立安装。

## 1.1.1 (2026-08-31)

### Changed

- **模型行文案改为「当前供应商/模型」**: 轨迹视图与对话视图的模型提示行前缀从「子代理模型」改为「当前供应商/模型」（英文同步为 `Current provider/model`），更准确地表达该行展示的是当前请求实际使用的供应商与模型。同步更新测试断言、simulate 脚本与文档示例。

## 1.1.0 (2026-08-31)

### Features

- **轨迹视图显示模型路由**: 子代理每次请求实际用的 provider/model 会显示在**轨迹视图**里——换模型（含 failover 切换）后自动多出一行「子代理模型：`provider/model`」。基于官方 `request/context` 帧（`trajectory-subagent-model` 定义），零宿主改动。
- **对话视图新增模型提示行**: 子代理**对话视图**新增上下文注入行（`chat-subagent-model` 定义，基于官方 `request/header` 帧的 `reason`）：
  - 子代理开始第一句：`子代理模型：provider/model`（写清当前用的供应商与模型）
  - failover 切换成功后：`已切换到：provider/model`（展示现在用的是哪个模型）
  - 会话恢复时：`继续使用：provider/model`
  - 折叠态即可见（`source.summary`），复用 DSH 原生 `ContextInjectionRow`。
- **切换提示文案改为 Provider**: 「连接失败时按队列与策略切换模型」的提示从「需配置 ≥2 个模型」改为「需配置 ≥2 个 Provider」。实测确认：官方重试按 `provider` 记账（`dsh-llm-retry`），同一 Provider 下多模型共享重试配额、第二个模型不重试；**每个模型配独立 Provider 时，各拿满自己的重试次数，全部失败才停**。

### Docs

- 新增 `docs/mock-failover-test.md`：本地 mock 模拟连接失败的完整测试指南（SSE 支持、`MOCK_ALL_FAIL=1` 全失败模式）。
- 新增 `docs/per-model-retry-design.md`：「每个模型独立重试 + 逐个切换 + 全部失败才停」的需求、根因分析（官方重试按 provider 记账）与实现方案；方案 B（每模型一个 provider）已实测通过。

### Testing / Scripts

- 新增 `plugin/test/client-trajectory.test.mjs`：轨迹 + 对话定义的单测（匹配、三种 reason 文案、节点结构、buildViewNode），测试 **36/36 通过**。
- 新增 `plugin/scripts/mock-llm-server.mjs`：本地 OpenAI 兼容 mock，支持 SSE 流式响应与全失败模式。
- 新增 `plugin/scripts/simulate-retry.mjs`：端到端 failover 模拟，输出轨迹/对话视图渲染预览。

## 1.0.0 (2026-08-29)

### Features

- **子代理连接失败自动切换（failover）**: 新增 `failoverEnabled` 复选框（默认勾选），子代理的模型请求遇到限流（RATE_LIMIT）、配额（QUOTA）、服务端/传输错误、空响应时，自动在 `models` 列表内按 `strategy`（轮换/随机）切换模型重试——**仅对 subagent 生效**，主代理循环不受影响。基于官方 `agent/request-error` + `agent/request` 瀑布，与社区的 `dsh-llm-fallback` / `dsh-model-failover` 插件同机制。
- **设置卡片新增复选框**: 设置面板「子代理默认模型」卡片的分配策略下方新增「连接失败时按队列与策略切换模型」复选框，默认勾选，保存后生效。

### Docs

- README 新增「子代理连接失败自动切换」章节，含配置示例与字段说明表。

## 0.3.5 (2026-08-28)

### Added

- **卡片底部「鼓励一下 ★」链接**: 设置卡片底部左侧新增低调灰色小字链接（含五角星），点击在新标签页打开 GitHub 仓库页；零依赖，仅用 CSS + Unicode `★`，不引用任何图标组件
- **文档 `docs/cheer-link.md`**: 独立说明该功能的效果、三步接入法、关键原理与可调参数，供其他插件直接复用

### Changed

- **卡片箭头改为空心宽折线**: 头部箭头从文字三角 `▾` 改为 `@deepseek-ai/dsh-client-ui-primitives` 的 `IconChevronDownOutline14`，与「网页搜索」等内置卡片一致；`.dsm-plugin-card-chevron` 加 `display:inline-flex` 使图标居中

## 0.3.4 (2026-08-26)

### Changed

- **设置卡片 UI 对齐内置插件**: 「子代理默认模型」卡片底部新增「放弃修改」按钮，与「保存」一起放入带顶边框的 footer；按钮样式精确复刻 DSH 内置设置卡片（描边「放弃修改」+ 实心「保存」、`border-radius:8px`、`padding:5px 14px`、禁用 `opacity:.4`）
- **添加模型按钮** 改为与内置一致描边样式
- **分配策略单行**: 「分配策略」标签改用纯文本 + `white-space:nowrap`，与下拉框（`max-width:150px`）同排一行
- **下拉框收窄**: 所有设置下拉与路由输入框 `max-width:220px`（策略行 `150px`），不再撑满整行
- 移除渲染中不再使用的内置 `Button` 引用

### Docs

- 同步 `README.md`、`README.en.md`、`RELEASING.md` 中发布包 `files` 说明（加入 `icons/`）

## 0.3.3 (2026-08-26)

### Features

- **插件卡片图标**: 「子代理默认模型」设置卡片标题前新增 LD（LaoDing）品牌 logo，图标以 data URI 内联，不依赖外部静态资源
- **npm 包图标**: `package.json` 新增 `icon` 字段（128px），`files` 加入 `icons/`，图标随包发布，便于市场与扩展市场识别

### Docs

- **仓库首页重构**: `README.md` 重排为标准开源插件格式，含标题、亮点、工作原理、效果预览、安装、配置、市场收录说明、开发、卸载、许可证
- **发布元数据完善**: `package.json` 补齐 `keywords`、`author`、`repository.directory`、`homepage`、`bugs`、`engines.node`
- 新增 `.github/workflows/ci.yml`（Node 20、`npm ci`、`npm test`、`npm pack --dry-run`）
- 许可证对齐 MIT，版权归属 `LaoDing`

## 0.3.2 (2026-08-24)

### Changed

- **设置面板迁移到「插件配置」**: 设置行从 `settings.general.item`（通用设置）迁移到 `settings.plugin.item`（插件配置），key 为 `subagent-default-model`。新增 `SubagentModelCard` 折叠卡片外壳，默认收起、点击展开，样式与其它可配置插件一致；卡片标题带插件名括号（如「子代理默认模型（dsh-subagent-default-model）」）。
- 文档同步：`README.md`、`plugin/README.md`、`PLUGIN_REQUIREMENTS.md`、`DEVELOPMENT.md` 中的「设置 → 通用设置 → 子代理默认模型」更新为「设置 → 插件配置 → 子代理默认模型」。

## 0.3.1 (2026-08-24)

### Docs

- **README 中英双语双文件**: `README.md` 重写为纯简体中文，新增 `README.en.md` 英文翻译，顶部加语言切换链接；`package.json` 的 `files` 加入 `README.en.md`

## 0.3.0 (2026-08-23)

### Features

- **推理强度选择**: 设置面板每行模型路由新增「推理强度」(Reasoning Strength) 下拉菜单，模型支持时自动加载可选强度（如 `high`/`medium`/`low`），不支持时显示「Default」
- **Host 侧支持**: schema 和 resolve 逻辑透传 `reasoningEffort` 到子代理的 `agentOptions`，覆盖单模型和多模型两种配置模式
- **Web UI 适配**: 设置面板 grid 从 3 列扩展为 4 列，新增中英文 locale 字段

### Fixes

- **序列化兼容**: `normalizeDefaultModels` 修复模型条目缺 `provider` 时继承顶层 provider 的逻辑
- **保存校验**: `serializeDefaultModels` 正确处理 `reasoningEffort` 字段序列化

## 0.2.0 (2026-08-19)

### Features

- 多模型支持：`models` 列表 + `round-robin` / `random` 策略
- 设置热重载：配置变更立即生效，无需重启

## 0.1.1 (2026-08-18)

### Features

- Web 设置面板（插件配置 → 子代理默认模型）
- 保存成功 Toast 通知

## 0.1.0 (2026-08-16)

### Features

- 初始版本：单模型默认注入
- Host 侧 `ctx.subagents` 服务包装（`start` / `startContinuable`）