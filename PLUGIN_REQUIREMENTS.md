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

### 设置卡片注册模式：
```js
ctx.slots.inject("settings.plugin.item", function() {
  return ctx.slots.register({
    name: "settings.plugin.item",
    key: "subagent-default-model",
    locale: "settings.subagentModel"
    // ...
  }, SubagentModelCard);
});
```

## 5. cordis.patch.yml 声明（已通过审核）

```yaml
- insert:
    - id: dsh-subagent-default-model
      name: 'dsh-subagent-default-model'
```

## 6. 设置行白名单问题（当前版本已解决）

### 历史问题（DSH 0.1.0-rc.6 时代）：
旧版 DSH 的 `dsh-host-apiproxy` 对 settings 做 `WEB_SETTINGS_NAMESPACES` 白名单过滤，默认不会暴露自定义插件的 settings，需要手动修改 `dsh-host-apiproxy/lib/index.js` 添加 namespace。

### 当前状态（已验证，DSH 0.1.1-rc.2）：
`dsh-host-apiproxy` 已**移除白名单机制**，`settings.describe` 直接返回全部已注册 namespace（源码见 `settings: { describe() { ... namespaces: settings.describe({ redactSecrets: true }).map(namespaceView) } }`）。**无需任何 patch**，插件 `installSettingsSection` 注册的 `subagent-default-model` 段对 Web 客户端天然可读写。

## 7. 安装流程（已通过审核）

### 正确安装（DSH Desktop / desktop profile）：
```bash
dsh plugin --profile desktop add /绝对路径/plugin
```

### 关键注意事项：
1. **首次注册只做一次** ❌ 不要重复执行
2. `link:` 方式安装不会重装依赖树，**不触发模块双胞胎**（旧 `fix-module-twins.sh` 已废弃删除）
3. 更新后**必须重启 DSH 进程**（bundle patch 启动时加载）

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

发布到 npm registry。**完整权威流程见仓库根目录 [`RELEASING.md`](RELEASING.md)**（含 2FA 确认、tag 修正、代理、验证步骤）。

要点速览：

```bash
# 1. 测试
npm --prefix plugin test
# 2. 更新版本号（plugin/package.json）与 CHANGELOG.md
# 3. 提交并打 tag
git add plugin/package.json plugin/CHANGELOG.md
git commit -m "chore: 版本升级至 X.Y.Z"
git tag -a vX.Y.Z -m "vX.Y.Z: <说明>"
git push origin main
git push origin vX.Y.Z
# 4. 发布（账号若开启 2FA，需在浏览器确认）
cd plugin && npm publish
```

> ⚠️ 发布后如需在本地 desktop profile 使用 npm registry 版本：
> `cd ~/.dsh/profiles/desktop && npm install dsh-subagent-default-model`
> 安装后重启 DSH Desktop 进程。`link:` 本地开发不受影响。

## 10. 常见故障排查清单（已核实）

| 问题 | 原因 | 解决方法 |
|------|------|----------|
| 保存按钮灰色 | Provider/Model 未填满 | 填写所有路由的 provider 和 model |
| 设置不生效 | 未重启 DSH 进程 | **重启 DSH 进程** |
| 子代理用父模型 | provider 为空或缺失 | 确保 `provider` 和 `model` 都填写 |
| 设置行不出现 | 插件未装入 profile 或未重启 | `dsh plugin --profile desktop add` 后重启 DSH Desktop |

## 11. 重要红线总结（经过 subagent 审核确认）

1. ✅ **`package.json` 必须暴露 `./package.json`** → 不然 dsh-client-modules 扫描跳过
2. ✅ **客户端 `inject` 必须包含 `connection`、`slots`** → 设置行激活必需
3. ✅ **设置 namespace 无需白名单** → 当前版本（0.1.1-rc.2）apiproxy 已移除白名单
4. ✅ **首次注册只做一次** → 以 `link:` 安装，重复注册会重装依赖
5. ✅ **更新后必须重启 DSH** → bundle 层加载需要重启
6. ✅ **settings 文件编辑是热加载** → 不需要重启，但安装插件后要重启

## 12. DSH Desktop 特有要求（已验证）

本插件已面向 DSH Desktop 运行验证（desktop profile，端口 3081 pocket / 43120 主界面）：

- [x] 通过 `dsh plugin --profile desktop add` 以 `link:` 方式安装（`dependencies` + `dsh.profile.bundles` 自动 reconcile）
- [x] 无需 apiproxy 白名单 patch（0.1.1-rc.2 已移除）
- [x] 修改源码后重启 DSH Desktop 生效

---
*审核说明：以上要求基于您项目 `dsh-subagent-default-model` 的实际代码和配置，通过了 subagent 审核。*"