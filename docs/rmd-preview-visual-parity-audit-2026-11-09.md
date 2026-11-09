# RMD 可视化编辑与预览模式逐组件一致性审计（2026-11-09）

> 审计工作树：`E:/Recalloom-parity-audit`，分支 `audit/rmd-preview-visual-parity`。基线是 `1320cc0`。独立 8805 本地 Worker、随机测试密钥、专用 D1；不使用生产数据库；不更改 `E:/Recalloom` 性能优化目录。

## 一、判定原则

- **正确的不一致**：源码编辑器和可视化可以显示 `@ attrs` 编辑标签、标题编辑铅笔、代码设置控件等，但预览不得显示这些编辑元信息；合法 `%%` 注释在预览隐藏；CriticMarkup 的尚未确认增删应投影为已确认旧正文；无效语法必须原文回退。
- **必须一致**：同一份源码中的组件语义、颜色、图标、文字、标题、公式、图片及引用的实际阅读结果、交互和响应式布局。
- **交互模式差异**：编辑器节点需要保持可编辑 DOM；预览可以使用无状态只读投影，但展开、切换、提示等阅读操作必须可用且不能写入版本。

## 二、已定位并修复的问题

1. **P0 颜色丢失、预览组件样式缺失**：`web/src/tiptap/editor.css` 只由动态加载的 `visual-editor.tsx` 引入，直接进入 `preview` 时没有加载。实际 DOM 的红色 Highlight 在两视图均拥有 `data-rk-color=red`，但预览计算背景仍为默认黄色，证明是 CSS 加载边界而非解析器问题。独立审计分支让 `markdown-preview.tsx` 同样加载公共组件规则，9 种颜色全部实测修正。
2. **P1 Tabs/Tab 结构不同**：只读视图遗漏容器标题和选项卡标题、muted 子卡片，实际高度由 243px 与 101px 相差明显。修改 `TabsPreview`，补齐标题、内层卡片与布局，并与编辑器使用一致的 Astryx `TabList` 按钮约定。
3. **P1 Flashcard/Front/Back 结构和切换位置不同**：旧预览在答案区底部放单独 Collapsible；可视化在头部提供揭示按钮和正反面卡片。现新增 `FlashcardPreview`，保留只读结构、上下文相同的头部按钮和正确隐藏的答案面板；揭示/关闭均通过真实浏览器测试。
4. **P1 Tooltip/Abbr 显示机制不同**：原预览依赖浮层 Tooltip，可视化使用焦点/悬停 CSS 伪元素。预览复用与编辑器相同的 `rk-tooltip-inline`，支持键盘聚焦、触发及提示文案，保留 `aria-label`。
5. **P2 容器边距/结构**：Callout 补足阅读容器的外边距、Glossary 的 Definition 补足因编辑 NodeView 包裹而产生的布局差别；链接卡片补齐视觉容器包装与外边距；Tabs 子卡片边距归一。
6. **P1 移动帮助页参数表文字逐字断裂**：原帮助参数表在窄屏上压缩列宽。为表头/表格单元指定合理最小宽度，表格自身横向滚动而非整页溢出。375px Edge 实测表格 `clientWidth=309`、`scrollWidth=651`、页面 `scrollWidth=375`。
7. **测试跨平台稳定性**：帮助生成文件在 Windows CRLF 下，旧测试硬编码 \n 导致失败。改为支持 `\r?\n`；帮助页面原 E2E 对 lazy viewport 内容先等待后滚动，改成先滚动实例再等待，符合 IntersectionObserver 懒加载设计。

## 三、逐组件审查矩阵

| 组件/结构 | 核验情况 | 结论 |
| --- | --- | --- |
| 行内 Mark | 默认黄色独立于 Highlight | 通过，保持原观感 |
| 行内 Highlight | 红橙黄绿蓝紫粉青蓝绿 9 色；深色 375px | **P0 已修**，与可视化颜色逐项相同 |
| Badge | 语义变体、标签内容和版式 | 通过 |
| Tooltip、Abbr | 解释文字、点状下划线、键盘聚焦 | **已统一** |
| Kbd | 键帽样式、文本、间距 | 通过 |
| Cloze | 隐藏/揭示、ARIA expanded、不会写 D1 | 通过 |
| 八种 Callout | note/info/tip/success/warning/danger/example/question，各自图标语义色及 22px 图标槽 | 通过；间距已调整 |
| 块级 Mark | 包裹纯公式时紧凑、有正文时铺满 | 通过；未改变原黄色 |
| 块级 Highlight | 9 色背景及块内 Markdown | 通过 |
| Details | 标题、展开内容及安全投影 | 通过 |
| Tabs / Tab | 标题、两组标签、当前面板及内容背景、切换状态 | **已修复** |
| Chat / Message | 用户/Assistant 消息顺序、正文内容和对齐 | 通过 |
| Flashcard / Front / Back | 卡片头部开关、正反面内容、显隐状态 | **已修复** |
| Glossary / Definition | AST/CAS 两条术语、定义内容、缩进与边距 | 通过；边距已调整 |
| Embed | 无效目标降级提示一致；有效文档投影由原 Wiki E2E 验收 | 通过已有功能测试 |
| Link-card | 共享 LinkCardView、元信息、宽度及图片布局 | 通过；增加预览容器边距 |
| Heading / Paragraph attrs | ID 在编辑模式显示、预览不显示 | **预期差异，正确** |
| Image attrs | 实际 SVG/宽度、`fig-` 引用和图注 | 通过 |
| Table attrs | 表格居中、图注与相同数据 | 通过，留有少量像素级边距差 |
| Math attrs | 公式正确渲染；预览显示 `(1)`，可视化尚无同样的编号控件 | **残余差异，需单独规划** |
| Code attrs | Shiki 代码显示、文件名、换行与区块 | 通过 |
| GFM / 引用 / 任务项 | 语义一致；编辑模式可编辑复选框、预览只读 | 通过 |
| Footnotes | 预览采用标准文末脚注，编辑器展示可编辑脚注定义 | **仍有阅读布局差异**，需决定是否统一 |
| CriticMarkup | 预览只读投影已确认正文，编辑中显示建议/接受/拒绝 | **预期差异，正确** |
| `%%` 注释 | 合法注释预览隐藏，错误语法保留原文字 | **预期差异，正确** |

## 四、真实验证与性能关注

- 按 4 组真实 Markdown 文档（inline/callouts/structured/blocks）分别打开 `visual` 与 `preview`，保存完整 DOM 盒模型 JSON 及浏览器截图；每组在切换模式后验证数据库文本未变。
- 在深色手机视口 375px，验证 **9 种行内 Highlight + 9 种块级 Highlight + 8 种 Callout** 颜色逐项相等、无横向溢出。
- 真实 Edge 逐项操作测试：Mark/Highlight、Tooltip/Abbr、Cloze、8 Callout、Details、Tabs、Chat、Flashcard、Glossary、Figure、Table、Code；预览和可视化均通过。
- `pnpm check`、`pnpm help:check`、`pnpm test`（211/211）、`pnpm build:web` 全部通过，Web 现有 chunk 大小提示不影响本轮构建。
- `pnpm test:editor` 原 6 套真实 Edge 回归通过；`pnpm test:help:ui` 通过，已修复由 lazy-loading 测试滚动条件导致的偶发超时。
- 修复使用同一公共 CSS 文件在 preview 懒加载入口补齐样式。后续若需要再缩减 preview 首屏 CSS，可将 `editor.css` 的展示类规则抽到纯展示 CSS 共享入口，避免复制与不必要的编辑器专属选择器。

## 五、尚未统一、但本轮不应贸然改动

- **公式编号**：预览使用 `collectRmdPreviewRefs` 与 `rk-numbered-math-projection` 显示 `(1)`，可视化节点只有稳定 `equationId` 和可编辑标签。建议下一轮基于同一引用索引把编号投影加入可视化，避免凭 CSS counter 在嵌套公式、失效 ID、多个表格间出现编号漂移。
- **脚注位置**：预览 GFM footnotes 自动聚集于文末，Tiptap 编辑器按源码定义块展示。此为真正的阅读布局差异，若要严格一致，应在不改变 Markdown 结构和保存行为的前提下提供只读可视化投影，而不是直接移动 ProseMirror 内容节点。
- **像素级布局**：Tabs、Flashcard、Callout 仍会因为编辑器 NodeView 外壳、交互控件与焦点区域有少量高度差；此次优先保证有意义的标题、可见文本、色彩和交互一致。
- **并行开发**：远端 `main` 在审计期间继续前进，绝不直接将这次代码覆盖到 `E:/Recalloom` 性能开发工作区。后续合并前必须审查远端同一渲染文件的最新差异。

## 六、研究样本

- Edge DOM 对照：`tmp/rmd-parity-audit.json`、`tmp/rmd-parity-elements.json`、`tmp/rmd-parity-dark-colors.json`。
- 截图：`tmp/parity-screens/inline-*.png`、`callouts-*.png`、`structured-*.png`、`blocks-*.png`、`mobile-dark-*.png`。
- 审计脚本：`scripts/rmd-parity-audit.mjs`、`scripts/rmd-parity-elements.mjs`、`scripts/rmd-parity-interactions-e2e.mjs`、`scripts/rmd-parity-dark-e2e.mjs`。
