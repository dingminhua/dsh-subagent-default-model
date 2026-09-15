# Changelog

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