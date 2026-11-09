# RMD 公式横向滚动与纵向滚轮传递优化 · 2026-11-09

## 背景

在 Recalloom 的可视化和预览模式，块级数学公式一直被 CSS 设置为 `overflow-x: auto; overflow-y: hidden`。即使公式本身没有超出列宽，也会建立独立横向滚动容器。在某些浏览器、触控板或触屏交互环境，这可能影响纵向滚动链的传递。此前用户反馈鼠标在公式上方滚动时，主文档偶尔不继续滚动。

**诊断边界：** 本地 ASUS 上 Edge Headless 的实际测试中，优化前普通公式、超宽公式均能将纵向鼠标滚轮传递给 `.main-scroll`；移动触屏模拟也能推动主文档。故本轮并未在该环境中复现“完全截留纵向滚动”的原始症状。优化以减少独立滚动容器、消除无效滚动根和嵌套横向滚动作为保守兼容策略，不能声称已验证真实 iOS Safari 的表现。

## 版本、工作树与范围

- 开发位置：ASUS `E:/Recalloom-scrollbars-perf`，分支 `perf/lazy-code-scrollbars`。
- 基于先前代码块滚动条懒初始化提交 `59cfa3a`，并已将新的 `main`（`539a5bb`）合并到隔离分支（合并提交 `a1d3f9d`），保留最新三视图一致性修复。
- 仅修改编辑页面的公式滚动控制和对应样式，**不改变 Markdown 源文、KaTeX 内容、RMD Schema、序列化、数据库或保存行为**。
- 没有修改 ASUS 主工作树，不推送和部署生产环境。

## 设计与实现

1. 新增 `web/src/math-scroll.ts`：在一个 RecordEditor 根容器中复用 **一组 MutationObserver 和 ResizeObserver**，检查块级数学公式、KaTeX 预览、编号公式，以及 Mark 包裹的数学块。既监听容器，也观察 KaTeX 内容尺寸以适应字体加载或公式内容变化。
2. 对没有宽度溢出的公式，使用 `overflow-x: clip; overflow-y: visible`，使其不再成为独立的横向滚动容器。真正溢出时动态添加 `rk-math-scroll-active`，恢复 `overflow-x: auto` 和正常横向操作。
3. KaTeX 预览中，如果公式已经位于编号或高亮的外部滚动宿主之内，不再让内部 `.katex-display` 创建第二个滚动容器。
4. Mark-only 数学块仍保持按内容宽度收缩并居中；对真正超宽的 Mark 数学块，以 `display: block; width: fit-content; max-width:100%` 将外部宿主限制在阅读列宽中，使其能够独立横向滚动而不撑宽整页。
5. 切换三视图、调整窗口宽度、节点替换或 KaTeX 内容变化时动态重算，卸载页面时断开观察器。没有给每个公式额外绑定 `wheel preventDefault`，因此不抢夺原生滚轮和触控板惯性。

## 验证结果

在独立 Wrangler D1 服务 `127.0.0.1:8788` 的 Edge Headless 中，使用 `scripts/rmd-math-scroll-e2e.mjs`：

- 可视化、预览中的短公式均为 `overflow-x: clip / overflow-y: visible`，不再有无效滚动根。
- 宽公式（正文 + Mark）仍为 `overflow-x: auto`，可调整 `scrollLeft`，宽 Mark 外层 `clientWidth=760px`，内容 `scrollWidth` 约为 1905–2632px。
- 鼠标在短公式或宽公式上发送 `wheel deltaY=±270`，主文档滚动通常达到对应方向的完整 270px（若到达主文档边界则以剩余可滚动距离为准）。
- 中等宽度公式：1250px 视口下可完整显示且无滚动，缩至 390px 后自动开启横向滚动，恢复 1250px 后自动退出。
- Mark-only 短公式不创建滚动容器，超宽 Mark 公式仍保持可横向滚动，未扩大整个页面。
- Edge 模拟移动触屏纵向拖动（可视化、预览）均使主文档滚动；这**不等同于在真实 Safari 上验收**。
- 浏览器没有未捕获异常。
- `pnpm check`、`pnpm build:web` 通过，`pnpm test` **219/219** 通过，`pnpm test:editor` 六组 RMD 测试全部通过。此前代码块懒滚动条 `rmd-lazy-code-scrollbars-e2e.mjs` 也通过，包括宽度变化、离屏激活、横向边缘提示和源码模式内容保真。

## 后续观察

- 真实 iPhone Safari、Android 平板的触摸滚动与触控板手势仍需要设备级复验，特别是双指斜向滚动和超宽 Mark 公式内部横向拖动。
- 如果真实设备仍出现纵向手势截留，应收集具体浏览器、公式类型、横向/纵向手势和主文档位置，再决定是否需要有条件的滚轮转发，不能无条件 `preventDefault`；当前 Chromium 上原生滚动链本身已正常。
- 未来如增加多层嵌套数学容器，需要维持“**一个真正溢出的公式只有一个主横向滚动根**”的结构约束。

## 测试脚本

- `scripts/rmd-math-scroll-e2e.mjs`：公式溢出、宽度缩放、滚轮透传、Mark 公式。
- `scripts/rmd-lazy-code-scrollbars-e2e.mjs`：代码块滚动条懒初始化回归。
- 原始临时复现数据存储在 ASUS 独立工作树的 `tmp/math-wheel-*.json` 和 `tmp/math-touch-*.log`，不会将测试环境、登录信息或 D1 数据提交仓库。
