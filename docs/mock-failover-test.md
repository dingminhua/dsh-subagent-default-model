# 本地模拟连接失败，测试 subagent failover 切换

这个 mock 服务在本地模拟一个「OpenAI 兼容」的 LLM 端点：**第一个模型总是返回 429（RATE_LIMIT），第二个模型总是返回 200**。把它配进 DSH 后，subagent 请求第一个模型会触发连接类失败，插件 failover 自动切到第二个模型重试，轨迹视图里就会出现一行「子代理模型：provider/model」。

> 目的：不改任何中转商配置、不花真实 token，就能亲眼看到 failover 的完整链路。仅供本地测试用。

## 1. 启动 mock 服务

在插件目录下：

```bash
cd plugin
npm run mock
# 或直接：node scripts/mock-llm-server.mjs
```

默认监听 `http://127.0.0.1:8799`，输出：

```
mock LLM server listening on http://127.0.0.1:8799
  fail model: "deepseek-v4-pro" → HTTP 429 (RATE_LIMIT)
  ok   model: "deepseek-v4-flash"  → HTTP 200
```

可选环境变量（一般不用改）：

| 环境变量 | 默认 | 作用 |
| --- | --- | --- |
| `MOCK_FAIL_MODEL` | `deepseek-v4-pro` | 始终失败的模型 id |
| `MOCK_OK_MODEL` | `deepseek-v4-flash` | 始终成功的模型 id |
| `MOCK_FAIL_CODE` | `429` | 失败模型的 HTTP 状态码 |
| `MOCK_FAIL_CODEID` | `RATE_LIMIT` | 对应的 DSH 失败码（命中触发白名单） |

## 2. 在 DSH 里添加一个自定义 provider

在 DSH 的 **设置 → 模型提供商（或连接）** 里新增一个 provider（OpenAI 兼容协议）：

- **名称（provider id）**：例如 `mock-local`（插件路由里要用这个名字）
- **Base URL**：`http://127.0.0.1:8799/v1`
- **API Key**：任意非空字符串（mock 不校验），例如 `sk-mock`
- **协议 / wire API**：OpenAI 兼容（Chat Completions）
- **可用模型**：手动加入 `deepseek-v4-pro` 和 `deepseek-v4-flash`（或你在 mock 里配置的 fail/ok 模型名）

> 不同 DSH 版本 GUI 文案可能略有差异，按"OpenAI 兼容 / baseURL / apiKey"语义填写即可。

## 3. 配置插件 failover

插件设置里配两个路由（**必须 ≥2 个**才会生效），provider 用第 2 步创建的名字，模型依次是「失败模型 → 成功模型」：

```yaml
subagent-default-model:
  provider: mock-local
  models:
    - deepseek-v4-pro      # 会 429 失败
    - deepseek-v4-flash    # 重试成功
  strategy: round-robin
  failoverEnabled: true
```

（`provider` 一行是列表里裸字符串条目的公共 provider；failover 是 round-robin：失败后从 `deepseek-v4-pro` 切到 `deepseek-v4-flash`。）

## 4. 触发 & 观察

1. 保持 mock 服务运行。
2. 在 DSH 里让主代理调用任意 **subagent 工具**（`subagent` / `subagent_fork` 等）跑一个小任务。
3. 打开该 **subagent 的轨迹视图**：
   - 官方行：`已重试模型请求（1/5）`、`失败原因：...`（DSH 内置重试行）
   - 插件行：`子代理模型：mock-local/deepseek-v4-flash`（**本插件新增**，路径 A）

看到插件行出现，说明 failover 真实切换成功。

## 5. 顺便验证数据链路（无需 GUI）

不连 DSH 也能在 Node 里跑完整链路（真实插件代码 + 真实客户端渲染）：

```bash
cd plugin
npm run simulate
```

会打印 `① 失败 → ② 切换 → ③ request/context 帧 → ④ 渲染节点` 四步结果，并生成 `plugin/preview-trajectory-model.html`（浏览器打开即可看到效果）。

## 注意事项

- mock 只服务 `127.0.0.1`，不要把它当真实 provider 用。
- 主代理（root）如果也选中 `mock-local` 且命中失败模型，会正常报错——failover 只对 subagent 生效，这是设计行为。
- 测试完记得把插件路由切回真实 provider。
