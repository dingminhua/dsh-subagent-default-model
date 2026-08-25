# CLI 管理器项目转交文档（Handoff）

> **用途**：这是把「外部 Agent CLI 管理器」从 `dsh-subagent-default-model` 插件中**拆分出来、独立成新项目**的完整转交文档。
> 新项目里的 AI **只需读取本文件即可完整理解设计意图并开始开发**，无需依赖任何旧对话上下文。
> 编写时间：2026-08-25。本文件自包含，含设计、调研结论、技术验证、参考实现、本机现状、建议开发路径。

---

## 0. 一句话概述

在 DSH（DeepSeek Harness）中做一个**独立的「外部 Agent CLI 管理器」插件**，让用户把 Codex、Claude Code、OpenCode、Kimi、Qwen 等 Agent CLI 下载/安装到**统一的指定目录**（不与系统 PATH 混用），在 Web 面板里**呈现已装/未装状态**、**选择统一目录**、**为每个 CLI 独立配置模型**，并注册**派发工具/技能**让模型调用，复用 `subagent-default-model` 的模型轮换策略。

---

## 1. 设计目标

1. **统一目录**：把各 Agent CLI 的二进制集中放到一个用户可选的目录（默认 `~/dsh-clis/`），避免散落系统 PATH。
2. **每个 CLI 独立配置模型**：各 CLI 用各自的配置目录（隔离），模型独立。
3. **Web 面板**：
   - Web 里选择统一目录；
   - 呈现已准备好的 CLI（已装 ✅ / 未装 ❌ / 配置状态）；
   - 引导/提示安装命令（简单语言）。
4. **派发**：注册工具/技能，按配置路径调用目标 CLI，结果回传会话；**Skill 可以调用**这些准备好的 CLI。

---

## 2. 用户核心意图（必须满足）

1. **优先支持能独立配置模型的 CLI**：Codex、Claude Code、OpenCode、Kimi、Qwen（它们支持环境变量/参数指定配置目录和模型）。不纳入只能用内置模型的 CLI（Trae、Cursor、Copilot、WorkBuddy、Grok 等）。
2. **模型策略复用 subagent 的**：不单独设一套策略，复用 `dsh-subagent-default-model` 已有的 single/multi-model + round-robin/random。
3. **下载做好提示**：用**简单语言**引导用户下载到统一目录，不装到系统目录。
4. **统一目录在 Web 面板选择** + **呈现已装 CLI**，这样 **Skill 可调用**。

---

## 3. 统一目录模型（两层隔离）

```
~/dsh-clis/                      ← Web 面板可选的根目录
├── bin/                          ← 各 CLI 二进制/软链（进程本体）
│   ├── codex → ~/.codex/plugins/.plugin-appserver/codex
│   ├── claude
│   ├── opencode
│   └── kimi
├── config-codex/                 ← 各 CLI 独立配置（通过环境变量隔离）
│   └── config.toml
├── config-claude/
│   └── settings.json
└── config-opencode/
    └── opencode.json
```

**两层各自独立**：
- `bin/` 隔离**进程**（二进制本体）；
- `config-<cli>/` 隔离**配置**（模型配置，通过环境变量指向）。

**「和用户自己装的没关系」**：启动时用环境变量把配置目录指向统一目录内的 `config-<cli>/`，**完全不碰**用户系统默认路径（`~/.codex/config.toml`、`~/.claude/settings.json` 等）。用户系统里已经装的那份完全不受影响。

代码范式：
```bash
# 派 Codex：配置目录指向统一目录内 config-codex，不影响系统安装
CODEX_HOME=~/dsh-clis/config-codex ~/dsh-clis/bin/codex exec "任务"

# 派 Claude Code
CLAUDE_CONFIG_DIR=~/dsh-clis/config-claude ~/dsh-clis/bin/claude -p "任务"
```

---

## 4. 重要技术结论：不需要写代理

**第一步不需要代理。** 每个 CLI 用它的**原生认证 + 原生模型**，只是配置目录被隔离到统一位置。与用户直接在终端里用一模一样，零协议转换、零代理。

**只有**当你想做「让 Codex 用 DeepSeek / 让 Claude Code 用 Kimi」这类**跨供应商调动模型**时，才需要写代理（协议翻译层，因为 Codex 只认 OpenAI `responses` 协议，要转到别的供应商 API 需要转换）。

---

## 5. 各 CLI 配置隔离方式（最终调研结论）

| CLI | 配置目录隔离方式 | 运行时指定模型 | 是否支持隔离 | 纳入 |
|---|---|---|---|---|
| **Codex** | `CODEX_HOME` 环境变量（二进制确认；Cindy 实证） | `-m, --model`；`-c key=value` 运行时覆盖任意 config；`--profile` | ✅ | 首批 |
| **Claude Code** | `CLAUDE_CONFIG_DIR` 环境变量 | `ANTHROPIC_MODEL` 或 `--model` | ✅ | 首批 |
| **OpenCode** | `OPENCODE_CONFIG` 环境变量（指定文件路径） | 配置文件 `"model"` 或 `--model` | ✅ | 首批 |
| **Kimi CLI** | `--config-file <PATH>` 参数 | `-m, --model`；`KIMI_MODEL_NAME` 环境变量 | ✅ | 首批 |
| **Qwen Code** | 环境变量 + CLI 参数 | `--model`；`QWEN_MODEL` | ✅ | 首批 |
| **Gemini CLI** | 待确认 | 待确认 | ❓ | 暂不纳入 |
| Trae / Cursor / Copilot / WorkBuddy / Grok | 通常无自定义配置目录 | 内置模型为主 | ❌ | 暂不纳入 |

---

## 6. 参考实现

### 6.1 dsh-agent-conductor（Cross-agent dispatch，已调研）

仓库：`https://github.com/MJorgin/dsh-agent-conductor`

提供在 DSH 会话中把自包含任务派给 **11 种外部 Agent CLI**（Codex、Claude Code、Trae、OpenCode、Gemini、Cursor、Kimi、Qwen、Copilot、WorkBuddy、Grok）在**无头模式**下执行并把 stdout 回传的工具 `conductor_dispatch`：

```js
// index.js 里的 Agent 注册表
const AGENTS = [
  { id: 'codex', name: 'Codex', argv: ['codex', 'exec', '{task}'], ... },
  { id: 'claude-code', name: 'Claude Code', argv: ['claude', '-p', '{task}', '--output-format', 'text'], ... },
  // ... 11 种
]
```

- **用 `subprocess.spawn` 调用外部 CLI**（`skills/conductor/scripts/dispatch.py` 是零依赖版，`index.js` 是 bundle 版）；
- **任务必须自包含**（对方看不到本会话上下文）；
- **host-only**，无 client UI，纯命令行式，卡片是 `presentCall: { card: 'generic', title: '指挥家 → codex' }`（默认文本卡片，无交互面板）；
- **Roadmap 里有 Panel UI 但未实现**。

**对你有价值的部分**：
- Agent 注册表设计（`{id, name, argv, install}`）；
- `argv` 里用 `{task}` 占位替换；
- `dispatch.py` 零依赖工程哲学；
- 未安装时的报错 + 安装提示（`${name} 未安装（或不在 PATH）。安装：${install}`）。

**不足/你的差异化**：Conductor **不管理目录**（直接用系统 PATH）、**不隔离配置**（不设 `CODEX_HOME` 等）、**不能独立配模型**、**无 Web 面板**、**模型策略不轮换**。你做的正是补上这些：统一目录 + 配置隔离 + 独立配模型 + Web 面板 + 复用 subagent 策略。

### 6.2 Cindy（本机已装，最佳配置隔离参考）

Cindy 是一个 DSH 类桌面应用，**已经实现了「给 Codex 指定模型」**：
- 把 Codex 配置目录整体搬到 `~/Library/Application Support/Cindy/codex-home/`；
- 配置 `codex-home/config.toml`：
  ```toml
  model_provider = "custom"
  model_catalog_json = '.../codex-home/model-catalogs/codexhub-model-catalog.json'
  [model_providers.custom]
  name = "Codex Proxy"
  base_url = 'http://127.0.0.1:9099/v1'
  wire_api = "responses"
  ```
- 用本地代理（`anthropic-compat-proxy/proxy.mjs`）接管 Codex 的模型请求。

**关键证**：Cindy 用 `codex-home/` 隔离 Codex 配置并指定模型，**证明 Codex 支持通过配置目录覆盖（CODEX_HOME）来隔离 + 指定模型**。但 Cindy 是**重场景**（跨供应商调模型，需要代理）；你的**轻场景不需要代理**。

---

## 7. 本机现状（开发环境实测）

- **已装**：Codex（二进制 `~/.codex/plugins/.plugin-appserver/codex`，v0.148.0），但**不在 PATH**，需 `ln -s ~/.codex/plugins/.plugin-appserver/codex ~/.local/bin/codex`。
- **未装**：Claude Code、OpenCode、Kimi、Qwen（多为 `npm i -g <pkg>` 一行命令）。
- **Cindy 已装**，其 `codex-home/` 配置可作为隔离参考（见 6.2）。
- npm 登录账号：`dmh2002`（发布用，账号开启 2FA，交互式发布需浏览器确认）。
- 代理：本机有 `http://127.0.0.1:7897`（Clash），已配置 npm/git 走代理（访问 GitHub/npm 更稳）。
- LDVH 项目（`/Users/dmh2002/poker_hud_projects/ld-vibe-harness-v4`）中有大量 DSH 插件调研积累（dshfind 源码等），需要时可参考。

---

## 8. 建议技术实现路径

### 8.1 参考现有插件模式（`dsh-subagent-default-model`）

现有插件已把设置面板迁移到**插件配置卡片**（`settings.plugin.item`），这是可复用的卡片模式：

- Host 端 `plugin/lib/index.js`：
  ```js
  export const name = "dsh-subagent-default-model";
  export const inject = ["subagents", "settingsScope"];  // 注入 settingsScope
  installSettingsSection(ctx, ns, schema, entry, { setSource, onChange }); // 注册 settings namespace
  // 包装服务 / 注册工具
  ```
- Client 端 `plugin/lib/client.js`：
  ```js
  // 卡片外壳（默认收起，样式与其它可配置插件一致）
  function SubagentModelCard(props) {
    const [open, setOpen] = React.useState(false);
    return React.createElement("li", { className: "dsm-plugin-card" + (open ? " dsm-plugin-card-open" : "") },
      React.createElement("button", { type: "button", className: "dsm-plugin-card-header", ... },
        title + description + chevron),
      React.createElement("div", { className: "dsm-plugin-card-body", hidden: !open },
        React.createElement(SubagentModelRow, props)));
  }
  // 注册到 settings.plugin.item
  ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
    name: "settings.plugin.item", key: "subagent-default-model", locale: "...", inject: subagentCardInjected,
  }, SubagentModelCard));
  ```
- 卡片外壳 CSS（`dsm-plugin-card*`，与系统 `PluginCard` 同款圆角/边框/折叠/hover/间距）已在该插件 `SETTINGS_CSS` 里实现，可移植。

### 8.2 建议的三步落地

**第一步（最小可用）**：
- Web 面板：统一目录选择 + CLI 列表（已装/未装）；
- 引导安装：每 CLI 的安装命令提示（简单语言）；
- 派发工具：`cli_dispatch`，按配置路径调用目标 CLI；
- 模型：先不选，用 CLI 默认模型。

**第二步（模型配置）**：
- 每 CLI 加自由文本模型输入框（填什么写进该 CLI 的 `config-<cli>/`）；
- 可选：复用 DSH 已有 provider 的 base_url 作为中转商。

**第三步（测试功能）**：
- 连通性测试（验证 base_url + key）；
- 模型列表探测（可选）。

### 8.3 模型策略落地的两个方向（需在开发时定稿）

复用 subagent 策略时注意一个坑：subagent 的模型策略能生效，是因为 DSH subagent 的 `agentOptions` 原生支持 `provider`+`model`；**外部 CLI 不支持命令行传 provider/model**（多数走配置文件）。所以有两条路：

- **方向 1（写入 CLI 配置）**：round-robin 选出模型 → 写入目标 CLI 的 `config-<cli>/` → 调用。要求所列模型在所有目标 CLI 的 config 里都有效，否则写入失败/回退。
- **方向 2（只调度 CLI，模型留给各 CLI 自己配，推荐起步）**：策略轮换的是「派给哪个 CLI」，每个 CLI 内部用哪个模型由用户在该 CLI 的 config 里单独配好。天然独立，最稳。

**建议先做方向 2**，让「统一目录 + 状态面板 + 派发工具」全部落地；方向 1 作为后续增强（等真需要跨 CLI 轮换同一批模型时再加）。

---

## 9. 测试功能定位（设计确认）

- **测试能**：①连通性（验证 base_url+key）；②`GET {base}/v1/models` 列模型（部分可靠）；③`codex doctor` 等 CLI 自带诊断。
- **测试不能**：保证模型质量/限额；保证 CLI 对某具体模型的兼容性（Codex `wire_api=responses` vs Claude `messages` 协议差异）。
- **建议定位**：测试只保**连通性**，**不依赖模型列表做决策**。模型用自由文本填，插件给默认值（gpt-4.1 / claude-sonnet-4）。

测试的实际验证（对话中实测过）：
- Codex `--version` → `codex-cli 0.148.0-alpha.9` ✅；
- Codex `--model`、`-c key=value`、`--profile`、`CODEX_HOME` 均可用（源码/二进制确认）；
- `codex doctor` 可诊断 auth / websocket / terminal 状态。

---

## 10. 放置位置（设计确认）

CLI 管理器放**插件配置区域**（`settings.plugin.item` 或独立 `settings.section`），**不是**通用设置（`settings.general.item`）。原因：信息量大（目录选择 + 多 CLI 列表），一行放不下；属插件配置，放插件配置页更合理。信息更密集时可用 `settings.section` 独立页面。

---

## 11. 待确认事项（开发决策点）

- [ ] 首批纳入哪些 CLI？（Codex 已装；Claude Code/OpenCode/Kimi/Qwen 待装）
- [ ] 模型策略：确认走「方向 2（只调度 CLI）」还是「方向 1（写入 CLI 配置，跨 CLI 轮换同一批模型）」
- [ ] 测试功能做到什么程度？（建议先只做连通性）
- [ ] 派发注册为 DSH Tool 还是 Skill？（用户提到「Skill 可调用」，倾向 Skill）
- [ ] 新插件独立成仓库，还是引用 `dsh-subagent-default-model` 的模型策略/卡片模式？
- [ ] npm 包名、命名空间、是否发布到 dshfind 市场

---

## 12. 关联资源

- 原插件：`dsh-subagent-default-model`（`/Users/dmh2002/DshProject/dsh-subagent-default-model`），其 `plugin/lib/client.js` 的卡片模式、`plugin/lib/index.js` 的 `installSettingsSection` + `settingsScope` 模式可直接复用。
- 设计文档：`CLI-MANAGER-DESIGN.md`（同目录，更精简的设计要点版）。
- 参考项目：
  - dsh-agent-conductor（外部 CLI 派发，仓库 `MJorgin/dsh-agent-conductor`）
  - Cindy（本机 `/Applications/Cindy.app`，配置隔离参考）
- DSH 内置市场插件目录：`/Applications/DSH Desktop.app/Contents/Resources/app.asar.unpacked/node_modules/@deepseek-ai/dsh-client-ui-settings-plugins`（卡片/插槽实现参考）。
