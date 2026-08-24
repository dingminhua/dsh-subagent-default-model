# 本地开发工作流（避免"模块双胞胎"）

## 一句话原则

**注册一次，迭代只同步文件、不重装依赖。**

重复执行 `dsh plugin add` / 在 web profile 里 `pnpm install`，会把
`~/.dsh/profiles/web/node_modules/@deepseek-ai/*` 重新装成**真实目录**并与 host
（CLI 本体，rc.6）版本错配。这会导致 DSH 出现"模块双胞胎"：同一个 `dsh-tools`
被加载成两份物理副本，其模块级 `Symbol()` 钥匙互不相认，工具分发报
`Cannot read properties of undefined (reading 'prepare')`。

## 正确流程

1. **首次注册（只做一次）**
   ```bash
   dsh plugin add /Users/dmh2002/GithubProject/dsh-subagent-default-model
   ```
   把插件挂进 web profile。之后不要再为迭代重复执行这条命令。

2. **日常迭代（改完代码）**
   ```bash
   bash dev-web.sh
   ```
   脚本会：停掉旧 DSH web → 把 `plugin/lib/*` 与 `plugin/package.json`
   `cp -R` 同步进 profile 副本 → 整进程重启。
   **不触发任何 install**，因此不会引入双胞胎。

3. **改了 `package.json` 依赖、必须重装时**
   - 装完后，`~/.dsh/profiles/web/package.json` 里的 `postinstall` 钩子会自动跑
     `~/.dsh/scripts/fix-module-twins.sh`，把 web 的 `@deepseek-ai/*` 重新对齐回
     host 软链。
   - 若仍怀疑漂移，手动执行一次：
     ```bash
     bash ~/.dsh/scripts/fix-module-twins.sh
     ```

## 不要做的事

- ❌ 每次改代码都重新 `dsh plugin add`
- ❌ 手动在 `~/.dsh/profiles/web` 里跑 `pnpm install`
- ❌ 让 `dsh update` 把 web 与 host 装成不同版本

## dev-web.sh 行为细节

- 监听 `plugin/lib/index.js`、`plugin/lib/client.js`、`plugin/package.json` 的
  mtime，每 2s 轮询；变更即同步 + 重启。
- 端口 3080。Ctrl-C 干净退出（停 web、释放端口，不留孤儿进程）。
- **整进程重启，非 HMR**：host 半边（`lib/index.js` 包 `ctx.subagents`）和 client
  半边（`lib/client.js` 设置 UI）都需整重启才生效。

## 双胞胎症状 & 修复

- 症状：`Cannot read properties of undefined (reading 'prepare')`，或工具调用全部失败。
- 修复：跑 `bash ~/.dsh/scripts/fix-module-twins.sh`（把 web 的 `@deepseek-ai/*`
  错配真实目录备份为 `.twins-bak/` 并换回 host 软链），然后重启 `dsh web`。

## 为什么市场 / `dsh plugin add` 会制造双胞胎

`dsh plugin add` 的本质是一个 **pnpm 转发器**（`@deepseek-ai/dsh/lib/plugin-*.js`）：
在 web profile 目录里 `spawnSync("pnpm", args)`。市场安装（dshmarket，web 目录下的
`.dsh-market/`）同样走这个通道。因此任何一次"装插件"动作 = 在 web profile 里
**重新解析整个依赖树并安装**：

1. pnpm 把 `@deepseek-ai/*` 按 registry 重新装成**独立真实目录**，版本与 host
   （CLI 本体）不一致（实测：host 0.1.1-rc.2 vs web 装出 0.1.0-rc.8）；
2. 磁盘出现两份物理副本 → Node 按真实路径加载成两个独立模块实例；
3. 各实例持有各自的模块级 `Symbol()` 钥匙，互不相认 → `prepare` 报错。

实测时间线（一次市场安装）：`.dsh-market/` 创建 → 连续多个 `pnpm-lock.yaml` 备份/
损坏文件（反复安装失败重试）→ `node_modules` 被重装 → 双胞胎成型。

所以文档开头的"注册一次，迭代只同步文件"不是保守，而是唯一正确做法。

## 备注

- 本工作流只调整本机 web profile 的**模块安装布局**（软链），不改 DSH 任何源码；
  便于区分"DSH 自己的问题"与"本地修改的问题"。
- 真正的根治在 DSH 上游：把 `Symbol()` 改成 `Symbol.for(...)`，使重复物理副本共享
  同一调度钥匙。在那之前，靠"不让两份副本出现"规避。
