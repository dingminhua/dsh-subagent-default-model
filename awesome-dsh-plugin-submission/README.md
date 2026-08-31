# 截图声明（新约定）

市场注册表的截图已改为「作者自持」约定：作者在插件仓库内、`package.json` 旁声明
`plugin/screenshots.json`，探测脚本自动读取 `.../HEAD/plugin/screenshots.json`，
无需向注册表 `data/screenshots.json` 提 PR（那是遗留 fallback，作者声明后会被自动清理）。

**生效文件**：仓库根的 [`plugin/screenshots.json`](../plugin/screenshots.json)（已推送 main）。

历史遗留：本目录旧版 `screenshots-entry.json`（legacy 单键 map 格式）已废弃，保留仅供追溯。
