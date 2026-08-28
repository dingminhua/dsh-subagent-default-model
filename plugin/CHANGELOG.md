# Changelog

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