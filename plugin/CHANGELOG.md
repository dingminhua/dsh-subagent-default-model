# Changelog

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