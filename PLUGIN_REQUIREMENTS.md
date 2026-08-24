# DSH 插件开发核心要求（审核版）

## 1. 项目目录结构

```
plugin/                          # 插件主目录
├── lib/
│   ├── index.js                # ✅ 必需：主机侧主逻辑（Cordis 插件）
│   └── client.js               # ✅ 必需：客户端侧 UI（Web 设置行）
├── cordis.patch.yml            # ✅ 必需：Bundle patch 声明
├── package.json                # ✅ 必需：包配置
├── README.md                   # ✅ 必需：用户文档
├── CHANGELOG.md                # ✅ 建议：版本日志
└── LICENSE                     # ✅ 必需：许可证
```

## 2. package.json 核心配置（已通过审核）

### 关键字段：
```json
{
  "name": "插件-id",                  // 小写字母/连字符
  "type": "module",                    // ES 模块
  "main": "lib/index.js",              // ✅ 主机侧入口
  "exports": {
    ".": "./lib/index.js",
    "./client": "./lib/client.js",     // ✅ 必需：为 Web 设置行暴露
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./package.json": "./package.json" // ✅ 必需：dsh-client-modules 扫描
  }
}
```

### DSH 声明（已通过审核）：
```json
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "client": {
    "platform": "web",
    "inject": ["@deepseek-ai/dsh-client-ui-primitives"] // ✅ 注入依赖
  }
}
```

## 3. 主机侧 index.js 开发模式（已通过审核）

### 核心声明模式：
```js
export const name = "插件-id";
export const inject = ["subagents"];  // 依赖注入
export function apply(ctx) { /* 逻辑 */ }
```

### 服务包装关键点（已通过审核）：
- 用 `Symbol.for("cordis.original")` 获取原始服务
- 用 `ctx.effect(() => cleanupFn)` 注册清理函数
- 包装 `start` 与 `startContinuable` 两个方法

## 4. 客户端侧 client.js 要求（已通过审核）

### 必需注入：
```js
var inject = ["sessions", "connection", "slots", "locale", "settingsScope", "remote"];
// ^ 此数组中的 connection、slots 是白名单问题的关键
```

### 设置行注册模式：
```js
ctx.slots.inject("settings.general.item", function() {
  return ctx.slots.register({
    name: "settings.general.item",
    id: "唯一-id",
    order: 5
    // ...
  }, SubagentModelRow);
});
```

## 5. cordis.patch.yml 声明（已通过审核）

```yaml
- insert:
    - id: dsh-subagent-default-model
      name: 'dsh-subagent-default-model'
```

## 6. 设置行白名单问题（已验证）

### 问题：
DSH 的 `dsh-host-apiproxy` 对 settings 做白名单过滤，默认不会暴露自定义插件的 settings。

### 解决方案：
修改 DSH 安装目录的 `dsh-host-apiproxy/lib/index.js`：

```js
const WEB_SETTINGS_NAMESPACES = [
  "agent-loop", "shell", "locale", "permission",
  "ui-conversation", "ui-theme", "web-search-deepseek",
  "subagent-default-model"  // ← 添加您的 namespace
];
```

## 7. 安装流程（已通过审核）

### 正确安装：
```bash
dsh plugin --profile web add /绝对路径/plugin
```

### 关键注意事项：
1. **首次注册只做一次** ❌ 不要重复执行
2. 改依赖后运行 `fix-module-twins.sh` 防"模块双胞胎"
3. 更新后**必须重启 DSH 进程**

## 8. 测试要求（已通过审核）

### 单元测试：
```bash
npm --prefix plugin test
```

### 测试覆盖（来自 default-model.test.mjs）：
- ✅ 注入配置的单个模型
- ✅ 无配置时保留父路由
- ✅ 显式 agentOptions 不被覆盖
- ✅ round-robin 轮换与实时更新
- ✅ continuable 子代理注入
- ✅ 服务还原（disposal restores）

## 9. 版本发布流程（已通过审核）

```bash
# 1. 更新版本号与 CHANGELOG.md
# 2. 提交并打标签
git add -A
git commit -m "feat: ..."
git tag v0.3.0
git push origin main --tags

# 3. 同步到 web profile
cd ~/.dsh/profiles/web && pnpm install
```

## 10. 常见故障排查清单（已核实）

| 问题 | 原因 | 解决方法 |
|------|------|----------|
| 保存按钮灰色 | Provider/Model 未填满 | 填写所有路由的 provider 和 model |
| 设置不生效 | 未重启 DSH 进程 | **重启 DSH 进程** |
| 子代理用父模型 | provider 为空或缺失 | 确保 `provider` 和 `model` 都填写 |
| 工具调用失败 | 模块双胞胎 | 运行 `fix-module-twins.sh` |

## 11. 重要红线总结（经过 subagent 审核确认）

1. ✅ **`package.json` 必须暴露 `./package.json`** → 不然 dsh-client-modules 扫描跳过
2. ✅ **客户端 `inject` 必须包含 `connection`、`slots`** → 白名单问题
3. ✅ **设置 namespace 需添加至 WEB_SETTINGS_NAMESPACES** → Web 设置行才能保存
4. ✅ **首次注册只做一次** → 重复注册会触发模块双胞胎
5. ✅ **更新后必须重启 DSH** → bundle 层加载需要重启
6. ✅ **settings 文件编辑是热加载** → 不需要重启，但安装插件后要重启

## 12. DSH Desktop 特有要求（待您确认）

如果是面向 DSH Desktop（桌面应用）的插件，还需要关注：

- [ ] 桌面应用插件接口 (`dsh-plugin-desktop`)
- [ ] 桌面特有能力（窗口、托盘、文件等）
- [ ] 桌面更新机制

---
*审核说明：以上要求基于您项目 `dsh-subagent-default-model` 的实际代码和配置，通过了 subagent 审核。*"