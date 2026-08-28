# 卡片底部「鼓励一下 ★」链接

> 给插件设置卡片底部加一个**低调的灰色小字链接**，点击跳到你的 GitHub 页面（用户可在那里 star）。
> **零依赖**：只用 CSS + Unicode 字符 `★`，不引用任何图标组件，任何 DSH 插件都能直接复制使用。

## 效果

卡片底部横向布局：

```
────────────────────────────────────────────────
鼓励一下 ★                    [放弃修改] [保存]
────────────────────────────────────────────────
  ↑ 贴最左（灰色小字+下划线）        ↑ 按钮组靠右
```

- 默认灰色小字（13px）+ 下划线，视觉很轻，不抢主操作按钮
- hover 文字变亮
- 点击在新标签页打开 GitHub

## 三步接入

### 第 1 步：加链接 URL 常量

在 client 模块顶部（`factory` 内）定义目标地址：

```js
// ── GitHub 页面（「鼓励一下」链接目标） ──────────────────────────────
var YOUR_GITHUB_URL = "https://github.com/<owner>/<repo>";
```

### 第 2 步：加 locale 文案

在中文 locale 对象里加：

```js
"row.cheer": "鼓励一下",
```

在英文 locale 对象里加：

```js
"row.cheer": "Star on GitHub",
```

### 第 3 步：加 CSS + 渲染

**CSS**（追加到你插件的 CSS 字符串里）：

```css
.xxx-footer-left{display:flex;align-items:center;gap:10px;flex:1;min-width:0}
.xxx-cheer{display:inline-flex;align-items:center;gap:4px;flex:none;text-decoration:underline;text-underline-offset:2px;color:var(--dsw-alias-label-tertiary,#999);font-size:13px;line-height:1.5;transition:color .16s}
.xxx-cheer-star{font-size:12px;line-height:1;display:inline-flex}
.xxx-cheer:hover{color:var(--dsw-alias-label-primary,#e6e6e6)}
.xxx-cheer:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:2px}
```

**渲染**（`React.createElement` 写法）：

```js
React.createElement("div", { className: "xxx-footer" },
  // 左侧组：鼓励链接 + 状态文本；flex:1 把右侧按钮组推到最右
  React.createElement("div", { className: "xxx-footer-left" },
    React.createElement("a", {
      className: "xxx-cheer",
      href: YOUR_GITHUB_URL,
      target: "_blank",
      rel: "noopener noreferrer"
    },
      t("row.cheer"),
      React.createElement("span", { className: "xxx-cheer-star", "aria-hidden": "true" }, "\u2605")
    ),
    /* 你原有的状态/错误文本放这里 */
  ),
  /* 你原有的按钮（如「放弃修改」「保存」）放这里 */
  React.createElement("button", { /* ... */ }, t("row.save"))
),
```

> 把 `xxx-` 替换成你自己的类名前缀（本插件用 `dsm-model-settings-`）。

## 关键原理（照抄时别改这两点）

1. **`flex:1` 的左侧组** 是让它真正靠左的关键。
   如果只把 `<a>` 直接放进 `justify-content:flex-end` 的 footer 里，整组会被推到右边，链接会紧挨着按钮、看起来像按钮组的一部分 —— **必须**用 `flex:1` 的包裹层占满剩余空间，才能把链接顶到最左、按钮留在最右。

2. **星星用 Unicode `★`（`\u2605`）**，不是图标组件。
   `@deepseek-ai/dsh-client-ui-primitives` 里**没有五角星图标**（只有 `IconLikeOutline16` 点赞和 `IconSparkle16` 星芒），所以直接用 Unicode 字符，与文字同色同族，最省事也最稳。
   星号外层加 `aria-hidden="true"`，避免屏幕阅读器把「★」读成多余内容。

## 可调参数

| 位置 | 值 | 作用 |
| --- | --- | --- |
| `.xxx-cheer` | `font-size:13px` | 正文字号（比旁边 12px 的辅助文字大一档） |
| `.xxx-cheer-star` | `font-size:12px` | 星星略小于文字，保持轻盈 |
| `.xxx-cheer` | `text-underline-offset:2px` | 下划线与文字间距 |
| `.xxx-cheer` | `color:var(--dsw-alias-label-tertiary,#999)` | 默认灰色（低调） |
| `.xxx-cheer:hover` | `var(--dsw-alias-label-primary,#e6e6e6)` | hover 变亮 |
| `.xxx-footer-left` | `gap:10px` | 链接与右侧状态文本的间距 |

## 完整可运行示例

见本仓库 `plugin/lib/client.js`，搜索 `row.cheer` 或 `DSM_GITHUB_URL` 即可定位到全部相关代码：

- URL 常量：`DSM_GITHUB_URL`
- CSS：`.dsm-model-settings-footer-left`、`.dsm-model-settings-cheer`、`.dsm-model-settings-cheer-star`
- 渲染：`SubagentModelRow` 的 footer 部分
- locale：`row.cheer`（中文「鼓励一下」/ 英文「Star on GitHub」）
