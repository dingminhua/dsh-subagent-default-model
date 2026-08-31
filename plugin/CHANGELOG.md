# Changelog

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