# @aaravarr/dsh-subagent-max

[English](README.md) | 中文

[![npm](https://img.shields.io/npm/v/@aaravarr/dsh-subagent-max.svg?style=flat-square)](https://www.npmjs.com/package/@aaravarr/dsh-subagent-max)
[![license](https://img.shields.io/npm/l/@aaravarr/dsh-subagent-max.svg?style=flat-square)](LICENSE)

> [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/DeepSeek-Harness) 的多面板实时子代理查看器，附带一个支持按调用指定模型/供应商的 `subagent_with_model` 工具。

## 截图

**子代理 Tab** —— 按「活跃中 / 不活跃」分组、按最后活动时间排序的卡片网格。

<img src="docs/subagents-tab.png" alt="子代理 Tab" width="720">

**浮动查看器弹窗** —— 可拖拽的实时面板，展示子代理的任务、推理（Think）、工具调用与文本输出。

<img src="docs/viewer-panel.png" alt="浮动查看器" width="720">

双面插件：

- **宿主侧**（`lib/index.js`）——Cordis 插件，注册 `subagent_with_model` 工具；它是 `ctx.subagents` 之上的薄壳，把 `model` / `provider` 转发进子代理的 `agentOptions`。
- **客户端侧**（`lib/client.js`）——Web UI，把每个子代理渲染成可拖拽、可缩放的浮动弹窗，实时（逐 token）展示输出，并提供一个带卡片网格的 **子代理** 标签页。

## 特性

- **按调用覆盖模型/供应商** —— 委派子代理时显式指定其模型。
- **多面板实时查看器** —— 同时打开多个子代理弹窗，每个都实时流式输出。
- **丰富的块渲染** —— 任务块、推理（Think）块、带输入/输出的工具卡、流式流光、Markdown。
- **子代理标签页** —— 卡片网格按「活跃中 / 不活跃」分组、按最后活动时间排序；展示模型、token、steps、上下文占比和相对更新时间。
- **拖拽弹出** —— 把卡片拖到画布上，弹窗正好落在松手处（带幽灵框预览）。
- **通知** —— 子代理开始或收到消息时，右上角弹出提示条。
- **多语言** —— 中 / 英，可在 DSH 设置中切换。

## 安装

```sh
dsh plugin --profile web add @aaravarr/dsh-subagent-max
```

或手动：把包放到 `<profile>/node_modules/@aaravarr/dsh-subagent-max/`，并在 `cordis.patch.yml` 里加上对应 entry（见 [配置](#配置)）。

## 配置

```yaml
- insert:
    - id: dsh-subagent-max
      name: '@aaravarr/dsh-subagent-max'
      config:
        subagentProvider: spawn        # spawn | fork | acp
        toolName: subagent_with_model
        backgroundMode: continuable    # one-shot | continuable
        maxDepth: 3
```

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `subagentProvider` | string | `spawn` | 子代理传输 provider。 |
| `toolName` | string | `subagent_with_model` | 面向模型的工具名；必须在已加载工具中唯一。 |
| `backgroundMode` | string | `one-shot` | `continuable` 返回持久化子代理 id；`one-shot` 前台运行。 |
| `maxDepth` | number | `3` | 子代理的绝对委派深度上限（`0` 禁止继续委派）。 |

## 使用

让模型带显式模型去委派：

> 用 `deepseek-v4-flash` 起一个子代理，帮我看看这个仓库的测试覆盖情况。

工具参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `model` | string | 是 | 子代理模型 id（如 `deepseek-v4-pro`、`deepseek-v4-flash`、`k3-256k`）。 |
| `provider` | string | 否 | LLM provider 路由；省略则继承父级。 |
| `description` | string | 是 | 简短（3-5 词）任务标签。 |
| `prompt` | string | 是 | 完整、自包含的任务。 |
| `run_in_background` | bool | 否 | 后台路由；默认跟随 `backgroundMode`。 |

## 已知限制

- 模型展示取自会话的 `request/header`；部分子代理可能拿不到模型。
- 最后活动时间是客户端跟踪并缓存在 `localStorage` 里的；全新加载后首次打开可能回退到会话的 `updatedAt`。
- 客户端 UI 仅面向 Web 平台。

## 开发

```sh
pnpm install
node --check lib/index.js lib/client.js
```

## 许可证

[MIT](LICENSE)