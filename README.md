<p align="center">
  <img src="assets/pic_01.png" width="860" alt="dsh-subagent-default-model settings panel" />
</p>

<h1 align="center">dsh-subagent-default-model</h1>

<p align="center"><b>为 DeepSeek Harness 子代理选择默认模型，并支持多模型轮换。</b></p>

<p align="center">
  <a href="plugin/README.en.md">English</a> ·
  <a href="#安装">安装</a> ·
  <a href="#配置">配置</a> ·
  <a href="plugin/CHANGELOG.md">更新日志</a> ·
  <a href="https://github.com/dingminhua/dsh-subagent-default-model/issues">问题反馈</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-subagent-default-model"><img src="https://img.shields.io/npm/v/dsh-subagent-default-model?style=flat-square&label=npm&color=cb3837" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/dsh-subagent-default-model"><img src="https://img.shields.io/npm/dm/dsh-subagent-default-model?style=flat-square&label=downloads" alt="npm downloads"></a>
  <a href="https://github.com/dingminhua/dsh-subagent-default-model/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/dingminhua/dsh-subagent-default-model/ci.yml?branch=main&style=flat-square&label=tests" alt="test status"></a>
  <a href="plugin/LICENSE"><img src="https://img.shields.io/github/license/dingminhua/dsh-subagent-default-model?style=flat-square" alt="MIT license"></a>
  <a href="https://github.com/dingminhua/dsh-subagent-default-model/stargazers"><img src="https://img.shields.io/github/stars/dingminhua/dsh-subagent-default-model?style=flat-square" alt="GitHub stars"></a>
  <a href="https://dshfind.com/plugins/dingminhua/dsh-subagent-default-model"><img src="https://dshfind.com/api/badge/dingminhua/dsh-subagent-default-model" alt="dshfind plugin"></a>
</p>

一个独立的 [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) bundle 插件。它只处理省略了 `agentOptions` 的子代理请求；显式指定的模型始终优先，DSH 核心包保持原样。

## 亮点

- **单模型默认路由**：所有未显式选模型的子代理使用同一条配置路由。
- **多模型调度**：通过 `round-robin` 或 `random` 在多个 provider/model 路由间分配。
- **逐路由推理强度**：每个模型条目可独立配置 `reasoningEffort`。
- **完整覆盖派发入口**：同时包装 `start()` 与 `startContinuable()`，覆盖 `subagent`、`subagent_fork` 以及其他调用 `ctx.subagents` 的发起方。
- **设置热更新**：编辑设置后，下一次派发立即采用新配置。
- **干净卸载**：Cordis 销毁插件时恢复原始服务方法。
- **原生设置卡片**：可在 `设置 → 插件配置 → 子代理默认模型` 中完成配置。

## 工作原理

```text
显式请求 agentOptions
  → subagent-default-model 设置
  → 继承父会话路由
```

- 显式提供的 `agentOptions` 对象不会被修改。
- 非空 `models` 列表优先于兼容用的单 `model` 字段。
- 无效或不完整条目会被忽略；没有有效配置时回退到父会话路由。
- 多模型策略支持顺序轮换与独立随机选择。

## 效果预览

### 设置面板

配置一个或多个模型路由、分配策略以及逐路由推理强度。

![子代理默认模型设置面板](assets/pic_01.png)

### 分配验证

10 个子代理在 `deepseek-v4-flash` 与 `Kimi-k3` 之间以 round-robin 策略实现 5/5 分配。

![子代理默认模型分配统计](assets/pic_02.png)

## 安装

推荐使用 DSH 插件命令安装 npm 已发布版本：

```sh
dsh plugin --profile desktop add dsh-subagent-default-model
```

若使用其他 profile，请把 `desktop` 替换成对应名称。也可以直接通过 npm 安装：

```sh
npm install dsh-subagent-default-model
```

安装、更新或卸载 bundle 后，需要重启对应的 DSH 进程；仅修改设置不需要重启。

## 配置

可以在 Web 设置卡片中配置，也可以编辑 `~/.dsh/settings.yaml`。

### 固定一个默认模型

```yaml
subagent-default-model:
  provider: deepseek-official
  model: deepseek-v4-pro
```

### 多模型轮换

```yaml
subagent-default-model:
  provider: deepseek-official
  models:
    - deepseek-v4-pro
    - deepseek-v4-flash
    - provider: other-provider
      model: another-model
      reasoningEffort: high
  strategy: round-robin # round-robin | random
```

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `provider` | string | — | 字符串模型条目共用的 provider。 |
| `model` | string | — | 单模型 ID，保留用于向后兼容。 |
| `models` | array | `[]` | 字符串或 `{ provider, model, reasoningEffort? }` 条目列表。 |
| `strategy` | string | `round-robin` | 多模型分配策略。 |
| `reasoningEffort` | string | — | 可选的逐路由推理强度。 |

## 市场收录与展示

插件已经包含可安装的 `dsh.bundle` manifest，并发布到 npm。社区市场通常从 [Awesome DSH Plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 注册表同步条目；仓库内的提交草稿位于 [`awesome-dsh-plugin-submission/dingminhua__dsh-subagent-default-model--plugin.yml`](awesome-dsh-plugin-submission/dingminhua__dsh-subagent-default-model--plugin.yml)。

市场卡片中的截图与 GitHub README 徽章是两套机制：

- **GitHub 徽章**由本 README 顶部的 Shields/dshfind 图片链接生成。
- **市场截图**由注册表 `data/screenshots.json` 控制；未配置时，市场会尝试从 README 提取图片。
- **市场图标/占位图**由具体市场的展示规则决定，并不是 npm `package.json` 的通用字段，也不是 README 徽章。

## 开发

```sh
npm --prefix plugin install
npm --prefix plugin test
```

根目录还提供两条聚焦回归命令：

```sh
node integration.mjs
node prove.mjs
```

完整开发说明见 [`DEVELOPMENT.md`](DEVELOPMENT.md)，发布步骤见 [`RELEASING.md`](RELEASING.md)。

## 卸载

```sh
dsh plugin --profile desktop remove dsh-subagent-default-model
```

重启 DSH 后 bundle 不再加载。`~/.dsh/settings.yaml` 中遗留的配置不会再生效，可按需手工删除。

## 许可证

[MIT](plugin/LICENSE)
