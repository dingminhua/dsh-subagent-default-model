# Changelog

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