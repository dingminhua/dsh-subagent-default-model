# dsh-subagent-default-model

[English](README.en.md) | 中文

为 [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) 中的子代理（subagent）派发选择默认模型，可通过 `~/.dsh/settings.yaml` 配置。

当创建子代理时未显式指定 `model`，本插件注入配置的默认模型 —— 因此所有 `subagent`、`subagent_fork` 以及任何省略 `agentOptions` 的工具调用都会经过它。显式传参的覆盖始终生效；配置段缺失或不完整时保持原有行为（子代理继承父会话路由）。

## 功能特性

- **单模型** —— 所有子代理运行在同一个配置模型上。
- **多模型** —— `models` 列表配合 `round-robin` / `random` 策略，让并行子代理分散到多个模型。
- **推理强度** —— 可为每个模型条目指定 `reasoningEffort`（如 `high`、`medium`、`low`）；Web 界面从模型目录加载可用的强度。
- **热重载** —— 设置变更立即作用于下一次派发。
- **干净卸载** —— Cordis 销毁时还原原始服务方法。

## 截图

**设置面板**（`设置 → 插件配置 → 子代理默认模型`）：配置一个或多个模型路由，支持 `round-robin` / `random` 分配策略与每路由推理强度。

![子代理默认模型设置面板](https://raw.githubusercontent.com/dingminhua/dsh-subagent-default-model/main/assets/pic_01.png)

**效果验证**：10 个子代理在 `deepseek-v4-flash` 与 `Kimi-k3` 之间 5/5 均衡分配（round-robin 实测）。

![子代理默认模型分配统计](https://raw.githubusercontent.com/dingminhua/dsh-subagent-default-model/main/assets/pic_02.png)

## 市场

[![dshfind 插件](https://dshfind.com/api/badge/dingminhua/dsh-subagent-default-model)](https://dshfind.com/plugins/dingminhua/dsh-subagent-default-model)

## 安装

从 npm registry 安装：

```sh
npm install dsh-subagent-default-model
```

或通过 DSH 插件命令（等价，内部同样走 npm）：

```sh
dsh plugin --profile desktop add dsh-subagent-default-model
```

## 发布（Release / Publish）

发布到 npm registry。**完整权威流程见仓库根目录 [`RELEASING.md`](../../RELEASING.md)**（含 2FA 确认、tag 修正、代理、验证步骤）。

要点速览：

```sh
# 1. 测试：npm --prefix plugin test
# 2. 更新版本号（plugin/package.json 的 version 字段）和 CHANGELOG.md
# 3. 提交并打标签
git add plugin/package.json plugin/CHANGELOG.md
git commit -m "chore: 版本升级至 X.Y.Z"
git tag -a vX.Y.Z -m "vX.Y.Z: <说明>"
git push origin main
git push origin vX.Y.Z

# 4. 发布到 npm（账号若开启 2FA，需在浏览器确认一步）
cd plugin
npm publish
```

> ⚠️ 发布前先跑一遍测试：`npm --prefix plugin test`。
> `package.json` 的 `files` 字段已限定只发布 `lib/`、`cordis.patch.yml`、`LICENSE`、`README.md`、`README.en.md`、`CHANGELOG.md`，`test/` 和 `node_modules/` 不会进入发布包。

本地安装（DSH Desktop / desktop profile）：

```sh
# 在 ~/.dsh/profiles/desktop 下执行（或使用 dsh plugin 命令）
npm install dsh-subagent-default-model
# 或本地开发：dsh plugin --profile desktop add /路径/plugin（link: 安装，改码即时生效）
```

说明：

- 本地开发用 `link:` 安装：`dsh plugin --profile desktop add /Users/dmh2002/DshProject/dsh-subagent-default-model/plugin`，node_modules 里是源码软链，改代码后**重启 DSH Desktop** 生效
- 正式安装 / 他机安装使用 npm registry 版本（见上方 Install）

## 配置

在 `~/.dsh/settings.yaml` 中添加：

```yaml
# 单模型
subagent-default-model:
  provider: deepseek-official
  model: deepseek-v4-pro

# 或多模型
subagent-default-model:
  provider: deepseek-official
  models:
    - deepseek-v4-pro
    - deepseek-v4-flash
  strategy: round-robin  # round-robin | random

# 带推理强度
subagent-default-model:
  provider: deepseek-official
  models:
    - model: deepseek-v4-reasoner
      reasoningEffort: high
    - provider: other-provider
      model: gpt-5.6
      reasoningEffort: max
  strategy: round-robin  # round-robin | random
```

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `provider` | string | — | 字符串类型模型条目的 provider。 |
| `model` | string | — | 单模型 id（向后兼容）。 |
| `models` | array | `[]` | 模型条目列表（string 或 `{provider, model, reasoningEffort?}` 对）。 |
| `strategy` | string | `round-robin` | 分配策略：`round-robin` 或 `random`。 |
| `reasoningEffort` | string | — | 可选推理强度（如 `high`、`max`）。 |

## 工作原理

```text
请求携带显式 agentOptions
  → subagent-default-model 设置
  → 继承父会话路由
```

插件包装宿主 `ctx.subagents` 服务（`start` / `startContinuable`），覆盖所有派发路径 —— 内置的 `subagent` / `subagent_fork` 工具，以及任何调用该服务但未提供 `agentOptions` 的自定义工具。

## 许可证

[MIT](LICENSE)
