# 插件市场收录适配提示词（可直接发给任何 AI / 插件作者）

> 用法：把下面 ``` 之间的内容完整复制，发给你要协助的 AI（如"请按此提示词检查并调整我的插件仓库"），或作为给插件维护者的检查单。它自包含，不依赖任何前置文档。
>
> 适用市场：DeepSeek Harness 官方社区市场（dsh-market）——其目录数据源为 awesome-dsh-plugin 注册表。

---

```
你的任务：检查并调整当前插件仓库，使其完全符合 DeepSeek Harness 社区插件市场（awesome-dsh-plugin 注册表）的收录要求。市场卡片、详情页与一键安装都依赖这些要求，缺一项就可能被拒绝收录或在市场里失效。

背景：市场应用（dsh-market）本身不维护插件列表，列表来自 awesome-dsh-plugin 注册表（data/plugins/ 下一个插件一个 YAML 条目）。收录由 CI 自动检查 + 维护者人工评审。你要确保"装上能用、和描述一致"。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
第一步：硬性条件自查（缺一不可，先补齐再谈其他）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. 安装性：仓库的 package.json 必须声明 dsh.bundle manifest（这是能用 `dsh plugin add` 安装的前提）：
   - ✅ 有 "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
   - ✅ 仓库内存在 cordis.patch.yml（声明插件行，例如 "- insert: [{id: 插件id, name: 包名}]"）
   - ⚠️ 只有 "dsh.client" 而没有 "dsh.bundle" 会被直接打回（无法安装）——这是最常见的被拒原因
   - 如果是 monorepo / 插件放在子目录（如 plugin/），只要根包或子包声明了 dsh.bundle 即可；条目会指向子包
2. 代码真实可用（非占位仓库、非纯 README 仓库、非名字占坑）
3. 仓库创建满 1 天且提交数 ≥ 10（CI 自动检查；不满足就先把功能做完再提交，复提交无任何影响）
4. 持续维护（长期停更 / 已归档 / 仓库消失会被定期扫描移除）
5. GitHub 仓库添加 dsh-plugin topic
6. 发布到 npm（强烈推荐：预构建安装免 build 授权、安装更快；不发 npm 则必须把预构建 tarball 挂到 GitHub Release 并在条目里用 tarball: 字段指向，且必须是 GitHub 托管 https .tgz）

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
第二步：调整 package.json
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- 声明 dsh.bundle（见上）；若有浏览器 UI，再加 dsh.client.platform: web
- 官方 @deepseek-ai/* 依赖用 peerDependencies 声明，不要用 dependencies
- peer 范围必须带显式预发布分支，否则会静默排除所有 0.1.0-rc.x 预发布构建、用户遇到 ERESOLVE。例：
  ❌ ">=0.0.1-rc.1 <0.2.0"
  ✅ ">=0.0.1-rc.1 <0.2.0 || 0.1.0-*"
- 确保包通过 npm pack 能正确打包（files 字段覆盖入口、客户端、patch、README、LICENSE、CHANGELOG 等）

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
第三步：撰写真实、可核查的描述
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- 一句话说清"插件做什么"，不加营销词/最高级形容词
- 描述会被当作对插件的声明并与代码逐字核对：写"46 个工具"就得真有 46 个；提到命令或 API 就得真实存在。夸大是让好插件被打回的头号原因
- 准备英文描述（必填，以句号结尾）；中文描述可选（写不了由维护者补，不会因此被打回）
- 若描述中英文都含冒号+空格（如 "Vision toolkit: OCR"），YAML 里必须加引号，否则解析失败

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
第四步：配置市场展示（可选但推荐）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- 市场截图按"作者自持"约定：在插件仓库内、package.json 旁放 screenshots.json（monorepo 就放在子包目录里）。探测脚本自动读取 https://raw.githubusercontent.com/<owner>/<repo>/HEAD/<子目录>/screenshots.json
  - 三种合法形状：路径数组 / {"screenshots": [...]} / 单 key map
  - 图片可用相对路径（须在插件目录内，禁止 .. 越界）；图片在插件目录外时用绝对 raw URL，host 必须是 GitHub 托管白名单（raw.githubusercontent.com / user-images.githubusercontent.com / camo.githubusercontent.com / github.com）
- 不配截图的市场会回退到 README 自动提取，展示效果较差

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
第五步：检查红线（触及必被拒）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- 纯聚合包不收：内容只有依赖清单、自己不带任何行为的 bundle 不单独收录（"收插件，不收聚合包"）；若聚合包自己做配置/设置/运行时协调则算插件
- 依赖必须指向上游：不能把别人的插件重新上传到自己账号下再依赖副本，依赖要解析到原作者仓库或 npm 包
- 不要动注册表里别人的条目（提交条目时只改/新增自己的 data/plugins/<owner>__<repo>.yml 文件）

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
第六步：提交收录（由你或维护者完成）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- 向 awesome-dsh-plugin/awesome-dsh-plugin 提 PR，只新增一个文件：
  - 普通仓库：data/plugins/<owner>__<repo>.yml，内容 url/name/category/description
  - monorepo 子包：data/plugins/<owner>__<repo>--<子目录连字符化>.yml，url 指向 /tree/main/<子目录>，name 用 owner/repo#子目录
  - category 取值：agi ui usage theme model identity session memory tools wsl browser vision voice docs skill workflow git notify dev security remote market fun（挑最贴近功能的，选不准维护者会直接改，不会打回）
- README 由脚本生成，禁止手改（本地可用 node scripts/generate-readme.mjs 预览自己的行）
- PR 合并后，官网与市场约一天内自动同步，无需在 dsh-market 做任何事

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
交付要求
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
请输出：
1. 逐项对照的检查结果表（✅ 已满足 / ❌ 需修改 / ➖ 不适用），给出具体证据（文件路径、字段、数值）
2. 需要修改的文件清单与具体修改内容（直接给出可用的代码/配置片段）
3. 建议的 category 与中英文描述（可直接放进条目文件）
4. 若存在无法满足的硬性条件，明确指出并给出补齐路径
5. 若一切就绪，给出完整的条目 YAML（data/plugins/<owner>__<repo>.yml 内容）供提交 PR

最后提醒：收录 ≠ 安全审计，市场不评判质量，只保证"装上能用、与描述一致"。不要为了过审夸大功能。
```

---

## 配套资料

- 完整调研文档（含评审细节、实战案例、PR 模板）：仓库根目录 [`MARKET_SUBMISSION_GUIDE.md`](MARKET_SUBMISSION_GUIDE.md)
- 注册表仓库：[awesome-dsh-plugin/awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)（contributing.md 为权威标准）
- 市场应用：[dsh-market/dsh-market](https://github.com/dsh-market/dsh-market)