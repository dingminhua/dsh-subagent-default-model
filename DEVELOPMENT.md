# 本地开发工作流（DSH Desktop + desktop profile）

> 📦 发布流程见 [`RELEASING.md`](RELEASING.md)。

## 一句话原则

**用 `dsh plugin add` 以 `link:` 方式装入 desktop profile，改代码即时生效（重启 DSH Desktop 生效），不复制文件、不重装依赖树。**

## 当前环境

- **运行实例**：DSH Desktop 应用（端口 3081 pocket / 43120 主界面），加载 `~/.dsh/profiles/desktop` profile
- **安装方式**：`dsh plugin --profile desktop add` 走 pnpm `link:` 本地链接——node_modules 里是源码目录的软链，改源码后无需重新安装
- **历史遗留**：旧的 `dev-web.sh` + `web` profile（端口 3080）工作流已废弃并删除，请勿重新引入

## 正确流程

1. **安装（首次/重装）**

   直接用 `dsh plugin` 命令在**新版桌面壳上已不可用**——它会拒绝：

   ```text
   error: profile "desktop" is managed exclusively by the Electron application
   ```

   正确入口是 **DSH Desktop 内的插件管理**（设置 → 插件 → 安装本地包，或让 AI 会话走 `plugin_manager` 工具的 `install_bundle`），target 传**插件包的绝对路径**：

   ```text
   /Users/dmh2002/DshProject/dsh-subagent-default-model/plugin
   ```

   安装结果等价于把该路径以 `link:` 写进 `~/.dsh/profiles/desktop/package.json` 的 `dependencies`，并 reconcile `dsh.profile.bundles` 列表。以 `link:` 安装不会重装依赖树，**不触发模块双胞胎**。

   安装后核对（宿主实时读回）：

   - `dsh.profile.bundles` 含 `dsh-subagent-default-model`
   - `node_modules/dsh-subagent-default-model` 是指向源码 `plugin/` 的软链
   - `listConfigs name=dsh-subagent-default-model` 返回条目 `id: include:dsh-subagent-default-model`

2. **改代码后**
   ```bash
   # 源码在 plugin/ 下，node_modules 里是 link 软链，直接生效
   # 但 bundle patch 与 host/client 半边在启动时加载，需要整进程重启：
   # 退出 DSH Desktop（⌘Q）→ 重新打开
   ```
   `plugin/lib/index.js`（host 半边）改动需重启；`plugin/lib/client.js`（client 半边）在页面刷新后即可重载。

3. **改了 `package.json` 依赖时**
   - 在 desktop profile 里重新 `add` 即可（`link:` 重新解析）
   - 旧文档的 `fix-module-twins.sh` 已不存在，`link:` 安装也不会制造双胞胎，无需处理

## 不要做的事

- ❌ 重新创建 `dev-web.sh` 或 `web` profile（3080 旧工作流已废弃）
- ❌ 手动把 `plugin/lib` 复制进 node_modules（`link:` 已保证实时同步）
- ❌ 手动在 `~/.dsh/profiles/desktop` 里跑 `pnpm install` 重装整个依赖树

## 设置命名空间白名单（当前版本已不需要）

旧文档提到需要把 `subagent-default-model` 加入 `WEB_SETTINGS_NAMESPACES` 白名单。当前 DSH 版本（dsh 0.1.1-rc.2）的 `dsh-host-apiproxy` 已移除该白名单机制，`settings.describe` 直接返回全部已注册 namespace，**无需任何 patch**。

## 测试

```bash
npm --prefix plugin test    # 单元测试（8 个用例）
node integration.mjs       # 派发与生命周期集成测试
node prove.mjs             # Cordis traceable-proxy 回归测试
```

## 验证清单（修改后）

1. 重启 DSH Desktop
2. 打开 **设置 → 插件 → dsh-subagent-default-model**，确认设置卡出现（`view: 'page'` 默认展开）
3. 保存后确认 `~/.dsh/profiles/desktop/cordis.patch.yml` 里 `id: dsh-subagent-default-model` 条目的 `config:` 更新
4. 创建一个不带显式 `agentOptions` 的子代理，确认其路由到配置的默认模型

## 历史遗留：旧 settings.yaml 不会被导入

0.1.6 及更早，本插件把配置注册为 `~/.dsh/settings.yaml` 的 `subagent-default-model` 段。0.1.7 起设置模型整体重建，该文件在启动时被**一次性导入并改名**为 `settings.yaml.imported`，此后不再回读。

导入按段名直接当条目 id 用（只有 `ui-developer-tools`/`ui-onboarding`/`shell` 三个历史段有重映射表），而本插件的条目 id 是 `dsh-subagent-default-model`，因此 `subagent-default-model` 段**导入失败**，宿主日志留一条：

```text
[settings-forms] settings: section subagent-default-model of …/settings.yaml.imported was not imported into entry subagent-default-model
```

旧值只留在 `.imported` 文件里，需要手工搬进 profile patch 的 `config:` 块（本仓实际发生过一次，见 CHANGELOG）。
