# RMD 代码块滚动条懒初始化 · 性能优化实施报告

## 版本与改动范围

- 日期：2026-11-09
- 起始版本：`f2014c447015126c5635129cc07062086ff7d8bb`，新正式性能基线的产品代码。
- 工作树：ASUS `E:/Recalloom-scrollbars-perf`，分支 `perf/lazy-code-scrollbars`，与 `E:/Recalloom` 的 `main` 隔离。
- **改动仅影响 Tiptap 代码块的 OverlayScrollbars 创建策略**，不更改 RMD 语法、Shiki、高亮主题、React CodeView 内容与工具栏、数据库、草稿、源代码/预览三视图。
- 生产环境未部署，测试只使用隔离的 `127.0.0.1:8788`、本地 Wrangler D1。

## 设计

新增 `web/src/code-scrollbars.ts`，提供 `attachLazyCodeScrollbars`：

1. 同一个 `Document` 复用一组 `IntersectionObserver` 和 `ResizeObserver`，避免每个代码块创建独立的观察器。
2. `IntersectionObserver` 使用 400px 的预读距离，代码块靠近视口时再采样 `scrollWidth > clientWidth + 1`；只有真实发生横向溢出时才调用原有 `attachScrollbars()`。
3. 对尚未创建滚动条的可见代码块，共享 `ResizeObserver` 监听容器和第一层内容的尺寸变化；在代码文本、折叠状态或换行属性变动后由 React Effect 主动调度一次采样。
4. 批量采样先读尺寸、后创建 OverlayScrollbars，降低布局读写交错。
5. OverlayScrollbars 创建后保留到 NodeView 卸载，不在每次进出视口时反复销毁重建；卸载后释放观察器、队列及资源。无 IntersectionObserver 或 ResizeObserver 时回退原来的立即初始化行为。
6. 代码始终完整挂载且可编辑，ProseMirror 的 `contentDOM` 不被虚拟化、卸载或手动重排；通用表格和页面滚动条不受影响。

## 同环境 A/B：四组约 50 KB 的 130 章节文档

同一个 ASUS、Edge、构建和隔离 D1，未优化版和优化版分别以三轮轮换顺序测试。待目标代码块全部挂载，再等待两个 requestAnimationFrame；数据来自 [完整原始 JSON](./rmd-lazy-code-scrollbars-ab-2026-11-09.json)。

| 样本 | 未优化三轮中位数 (ms) | 优化三轮中位数 (ms) | 相对变化 | 滚动条 DOM（前/后） |
| --- | ---: | ---: | ---: | ---: |
| 普通 Markdown | 475.69 | 544.23 | +14.4%（波动） | 0 / 0 |
| Badge ×130 | 601.22 | 617.93 | +2.8%（波动） | 0 / 0 |
| Callout ×130 | 709.71 | 789.11 | +11.2%（波动） | 0 / 0 |
| **代码块 ×130** | **1652.35** | **967.19** | **−41.47%** | **260 / 0** |

代码样本每轮完整挂载时间：原版 **1557.57 / 1685.69 / 1652.35 ms**，优化版 **1085.52 / 967.19 / 941.63 ms**，三轮均明显更快。其余组没有更改代码，但整体有波动，说明绝不能把单次测试差异当作普遍性能规律。

## 新正式基线的混合 RMD 复测

以下是不同运行时间的新正式基线与本轮三次优化版复测；**不是同一进程交替的严格 A/B**，系统负载、JIT 与 GC 不完全相同。仅作为趋势验证。

| 指标 | 旧正式基线 | 优化后三轮中位数 | 相对变化 |
| --- | ---: | ---: | ---: |
| 50 KB 完整可视化挂载 | 2428.75 ms | 1818.37 ms | −25.1% |
| 100 KB 完整可视化挂载 | 5756.82 ms | 3805.70 ms | −33.9% |
| 50 KB 输入帧延迟 | 17.6 ms | 25.2 ms | 波动，尚不能证明回退 |
| 100 KB 输入帧延迟 | 32.7 ms | 33.3 ms | 基本持平 |
| 10 KB 完整挂载 | 486.75 ms | 563.51 ms | 波动，不主张改善 |

输入指标是 keydown → 下一帧的代理指标，不是 INP。50 KB 输入三轮为 25.2 / 29.2 / 18.4 ms，100 KB 为 47.4 / 33.3 / 30.5 ms。应将后续长尾性能研究与此次滚动条挂载优化分开。

## 实际行为与回归

新增专项浏览器脚本 `scripts/rmd-lazy-code-scrollbars-e2e.mjs`，确认：

- 130 个短代码块完全挂载、末尾长代码尚未进入视口时，额外 OverlayScrollbars 为 **0**。
- 修改原本不溢出的代码内容，使其超出视口宽度后，能立即初始化两条 OverlayScrollbar DOM 元素。
- 滚动到很远的长代码块时才创建该块滚动条，真实宽度大于容器宽度，仍可横向滚动。
- 将窗口从 1250px 缩至 390px，先前无需滚动的代码块会自动创建滚动条。
- 横向滚动后两侧 `data-edge-start/end` 视觉提示正常。
- 三视图切换与 CodeMirror 虚拟渲染下，已编辑的内容与末尾代码仍然存在。
- 浏览器无 uncaught pageerror。

功能检查：`pnpm check` 通过、`pnpm test` **219/219** 通过、`pnpm build:web` 通过、`pnpm test:editor` 六组浏览器回归通过、`rmd-shiki-optimization-e2e.mjs` 的初始/编辑后 Shiki 着色专项检查通过。

## 限制与后续

- 工作仍在隔离分支；未推送 GitHub、未修改主工作树、未部署到生产。
- 缩小窗口等场景需要在真实 iOS Safari / Android 浏览器中专项检查，尽管代码仍保留原生滚动条策略与无观察器回退。
- 目前已激活的 OverlayScrollbars 会保持到该 NodeView 卸载，避免滚动过程中抖动；如果用户依次访问整篇文档中每一个真实溢出的代码块，实例数量仍可能累积。只有确认此模式产生实际内存问题，再研究离屏释放策略。
- 不建议这次将 Callout / Badge 同时改成原生 NodeView；应继续采用单一变量的独立 A/B 实验，避免无法归因。
- 新版本后续还可研究 Shiki 首次语法着色与 React NodeView 数量，但这些不是本轮修改范围。
