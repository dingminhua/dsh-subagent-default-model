# CLI 管理器功能设计草稿（临时，待定稿实现）

> 基于 `dsh-subagent-default-model` 插件扩展，新增「外部 CLI 管理器」功能。
> 设计于 2026-08-24，未实现，待后续推进。
> 本文件是设计意图的**唯一权威记录**：所有设计讨论、调研结论、澄清点均已收敛于此，供新对话直接接续。

## 目标

在 DSH 插件中新增一个「外部 CLI 管理器」，让用户：
1. 把 Agent CLI 下载/安装到统一的指定目录（不与系统 PATH 混用）
2. 每个 CLI 独立配置模型（通过该 CLI 的配置文件或运行时参数）
3. Web 面板呈现已装 CLI 的状态（已装/未装/配置状态）
4. 注册派发工具，让模型调用

## 用户核心意图（对话中确认，实现必须满足）

用户明确强调的四个关键点：

1. **支持设置模型的 CLI**——优先纳入那些能**独立配置模型**的 CLI（Codex、Claude Code、OpenCode、Kimi、Qwen），而不是只能用它内置模型的 CLI（Trae、Copilot 等）。
2. **调用模型策略与 subagent 一致**——CLI 管理器**复用** `subagent-default-model` 已有的模型策略（single/multi-model + round-robin/random），**不需要为 CLI 再单独设置一套策略**。
3. **下载做好提示**——用**简单语言**引导用户把 CLI 下载到一个**统一目录**（不装到系统目录，避免混用）。
4. **统一目录在插件 Web 里选择**——用户在 Web 面板里选择这个统一目录；Web 同时呈现**已准备好的 CLI**（状态可见），这样 **Skill 就可以调用**它们。

## 统一目录模型

```
~/dsh-clis/                      ← Web 面板可选的根目录
├── bin/                          ← 各 CLI 二进制/软链
│   ├── codex → ~/.codex/plugins/.plugin-appserver/codex
│   ├── claude
│   ├── opencode
│   └── kimi
├── config-codex/                 ← 各 CLI 的独立配置（通过环境变量隔离）
│   └── config.toml
├── config-claude/
│   └── settings.json
└── config-opencode/
    └── opencode.json
```

**两层隔离**（对话中确认的关键设计）：
- `~/dsh-clis/bin/` —— 各 CLI 二进制本体（存放进程）
- `~/dsh-clis/config-<cli>/` —— 各 CLI 配置（隔离模型配置，通过环境变量指向）

`bin/` 隔离进程、`config-<cli>/` 隔离配置，二者互相独立。

## 「和用户自己装的没关系」——重要澄清

对话中确认：**放在统一目录里的 CLI，其配置文件完全独立，和用户系统里自己装的那份没关系**。原理是启动时通过环境变量把配置目录指向统一目录内的 `config-<cli>/`，完全不碰系统默认路径（如 `~/.codex/config.toml`、`~/.claude/settings.json`）。**代码示例**：

```bash
# 派 Codex：配置目录指向统一目录内的 config-codex，不影响用户系统安装
CODEX_HOME=~/dsh-clis/config-codex ~/dsh-clis/bin/codex exec "任务"

# 派 Claude Code
CLAUDE_CONFIG_DIR=~/dsh-clis/config-claude ~/dsh-clis/bin/claude -p "任务"
```

用户系统里已有的 `~/.codex/config.toml`、`~/.claude/settings.json` **完全不碰、互不干扰**。

## 不需要写代理（除非跨供应商调动模型）

对话中确认的重要结论：**第一步不需要写代理**。每个 CLI 用它的**原生认证和原生模型**即可，只是配置目录被隔离到了统一位置。跟用户在终端里直接用一模一样，零协议转换、零代理。

**只有**当你想要"让 Codex 用 DeepSeek 模型 / 让 Claude Code 用 Kimi"这类**跨供应商调动模型**时才需要代理（协议翻译层）。

## 参考实现：Cindy（本机已装）

用户机器上的 **Cindy（DSH Desktop 类应用）** 已实现同样的"指定 CLI 模型"能力，是最佳参考：

- 把 Codex 配置目录整体搬到自己的管理路径：`~/Library/Application Support/Cindy/codex-home/`
- 配置 `codex-home/config.toml`：`model_provider = "custom"` + `model_catalog_json` + `[model_providers.custom] base_url = 'http://127.0.0.1:9099/v1'`
- 用本地代理（`anthropic-compat-proxy/proxy.mjs`）接管模型请求，由 Cindy 决定 Codex 能调哪些模型

**关键证**：Cindy 用 `codex-home/` + 代理的方式隔离 Codex 并指定模型，证明 Codex 支持通过环境变量/参数覆盖配置目录。但 Cindy 是**重场景**（跨供应商调动模型，所以需要代理）；你的场景是**轻场景**（每个 CLI 用原生模型），**不需要代理**。

## 各 CLI 配置隔离方式（最终完整调研结论）

| CLI | 配置目录隔离方式 | 运行时指定模型 | 是否支持隔离 | 纳入 |
|---|---|---|---|---|
| **Codex** | `CODEX_HOME` 环境变量（Cindy 已证实，二进制确认） | `-m, --model`；还支持 `-c key=value` 运行时覆盖任何 config、`--profile` | ✅ | 首批 |
| **Claude Code** | `CLAUDE_CONFIG_DIR` 环境变量 | `ANTHROPIC_MODEL` 或 `--model` | ✅ | 首批 |
| **OpenCode** | `OPENCODE_CONFIG` 环境变量（指定文件路径） | 配置文件 `"model"` 或 `--model` | ✅ | 首批 |
| **Kimi CLI** | `--config-file <PATH>` 参数 | `-m, --model`；`KIMI_MODEL_NAME` 环境变量 | ✅ | 首批 |
| **Qwen Code** | 环境变量 + CLI 参数 | `--model`；`QWEN_MODEL` | ✅ | 首批 |
| **Gemini CLI** | 待确认 | 待确认 | ❓ | 暂不 |
| Trae / Cursor / Copilot / WorkBuddy / Grok | 通常无自定义目录 | 内置模型为主 | ❌ | 暂不纳入 |

**本机现状**：`Codex` 已安装（二进制在 `~/.codex/plugins/.plugin-appserver/codex`，v0.148.0，但**不在 PATH**，需 `ln -s ~/.codex/plugins/.plugin-appserver/codex ~/.local/bin/codex`）；Claude Code / OpenCode / Kimi / Qwen 未装（多为 `npm i -g` 一行命令）。

## 模型方案讨论

### 方案 A（初期推荐）：运行时传参，不动配置文件

派发时直接用 CLI 的参数指定模型，不需要写配置文件：

```bash
# Codex 示例
CODEX_HOME=~/dsh-clis/config-codex codex exec -m gpt-4.1 "任务"

# Claude Code 示例
CLAUDE_CONFIG_DIR=~/dsh-clis/config-claude claude -p "任务"
```

### 方案 B（用户提出的简化思路）：统一走中转商

Web 面板里只提供两个选项（GPT / Claude），插件自动处理 base URL 的 v1 后缀：

- 选 GPT → 自动加 `/v1`（OpenAI 兼容协议）
- 选 Claude → 不加 `/v1`（Anthropic 协议，默认拼 `/v1/messages`）
- 大部分 CLI 都兼容 OpenAI 协议（除 Claude Code 外）

### 模型策略复用（对话中确认的实现方式）

- **复用** `dsh-subagent-default-model` 已有的模型策略机制（single/multi-model + round-robin/random），**不为 CLI 单独设置一套策略**。
- 但需注意一个坑（对话中确认）：subagent 的模型策略能生效，是因为 DSH subagent 的 `agentOptions` 原生支持 `provider`+`model`；**外部 CLI 不支持命令行传 provider/model**（多数走配置文件）。所以"复用策略"有两种落地：
  - **方向 1（写入 CLI 配置）**：round-robin 选出模型 → 写入目标 CLI 的 config 文件 → 调用。但同类模型必须在所有目标的 config 里都有效，否则写入会失败/回退。
  - **方向 2（只调度 CLI，模型留给各 CLI 自己配，推荐起步）**：策略轮换的是"派给哪个 CLI"，每个 CLI 内部用哪个模型由用户在该 CLI 的 config 里单独配好。天然独立。
- **建议：先做方向 2**，让"下载到统一目录 + 状态面板 + 派发工具"全部落地；**方向 1 作为后续增强**（等真需要跨 CLI 轮换同一批模型时再加）。

## 测试功能讨论

### 测试能做什么

1. **连通性测试**：发请求验证 base_url + API key 是否有效
2. **模型列表探测**：`GET {base}/v1/models` 获取中转商支持的模型列表（部分可靠）
3. **CLI 可用性验证**：`codex doctor` 或 CLI 自带诊断命令

### 测试不能做什么

- 不能保证模型的实际质量/限额
- 不能保证 CLI 对某个特定模型的兼容性（Codex 的 wire_api=responses vs Claude 的 messages 协议差异）

### 建议的测试定位

测试只保**连通性**（base_url + key 有效），**不依赖返回的模型列表做决策**。模型怎么选 → 用户手动填模型 ID（自由文本），或插件提供默认值（gpt-4.1 / claude-sonnet-4）。测试通 → 用户知道这个端点能用了，再自己填想用的模型。这样简单、可靠、不骗人。

## 放置位置：插件配置区域（对话中确认）

- CLI 管理器功能应放在 **插件配置区域**（`settings.plugin.item` 或 `settings.section`），**不是** 通用设置（`settings.general.item`）。
- 原因：CLI 管理器信息量大（统一目录选择 + 多个 CLI 列表，每行有状态/模型/测试），挤在一行不合适；它属于插件的配置，放插件配置页更合理。
- 本插件当前先完成了 `subagent-default-model` 设置从 `settings.general.item` → `settings.plugin.item` 的迁移（已做，卡片式）。CLI 管理器可复用同样的 `settings.plugin.item` 卡片模式，或用 `settings.section` 独立页面（信息更密集时）。

## 首期范围建议

### 第一步：最小可用

- Web 面板：统一目录选择 + CLI 列表（已装/未装状态）
- 引导安装：每个 CLI 的安装命令提示（简单语言）
- 派发工具：`cli_dispatch` 工具，按配置路径调用 CLI
- 模型：先不选，用 CLI 默认模型

### 第二步：模型配置

- 每个 CLI 加自由文本模型输入框（填什么写进什么 CLI 的 config）
- 可选：复选 DSH 已有 provider 的 base_url 作为中转商

### 第三步：测试功能

- 连通性测试（验证 base_url + key）
- 模型列表探测（可选）

## 待确认事项

- [ ] 首批纳入哪些 CLI？（Codex ✅ 已装，Claude Code/OpenCode/Kimi/Qwen 待装）
- [ ] 模型策略：确认走「方向 2（只调度 CLI，模型留给各 CLI 配）」，还是「方向 1（写入 CLI 配置，跨 CLI 轮换同一批模型）」
- [ ] 测试功能做到什么程度？（建议先只做连通性）
- [ ] 派发工具注册为 DSH Tool 还是 Skill？（用户提到"Skill 可以调用"，倾向 Skill）
- [ ] 代码放在当前插件里还是独立新插件？