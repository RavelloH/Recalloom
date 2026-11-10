# V6 编辑器交互微调：工具栏、拖放提示、文本选区（2026-11-10）

## 输入端一致的工具栏
触控 Pad/iPhone 顶部工具栏与桌面文字选区 BubbleMenu 使用同一份 React JSX `sharedFormattingToolbar`，杜绝布局/键盘 Tab 顺序漂移。

统一的格式操作顺序：**标题 → 粗体 → 斜体 → 列表 → 引用 → 链接 → 下划线 → 高亮（RMD Mark）→ 删除线 → 对齐 → 行内代码 → 行内公式 → 荧光笔与手绘 → 更多**。

触控顶部额外保留首部「+ 插入内容」，在 RMD 显式块内部时「编辑当前块 / 更多块操作」紧随其后。二者位于 sticky 的开头区域，在长工具栏横向滚动时保持可见；共享格式控件的实际 DOM 顺序完全不变。桌面不引入多余的「插入」按钮，保持快捷格式气泡紧凑。

## 分离拖放反馈
已确认 ProseMirror `prosemirror-dropcursor` 插件并不自动提供 `.ProseMirror-dropcursor` 通用 CSS 类名。旧选择器没有匹配到真实元素。

在 Tiptap StarterKit 的 `dropcursor` 上显式设置 `class:'rk-editor-dropcursor', color:false, width:3`，由 Recalloom CSS 根据当前主题控制颜色。普通文字拖动时保留完整 ProseMirror 插入点计算：
- 段内为圆角 3px 竖线，带上端圆形定位点；
- 段间为圆角横线，左右端点有小圆形节点；
- 背景与淡光影使用主题链接强调色，不再依赖插件默认的黑色/白色硬编码；
- 视觉层不拦截鼠标事件，也不自行修改编辑器拖放逻辑。

RMD 块把手拖动时 body 具有 `rk-block-drag-active`，CSS 隐藏原生 `.rk-editor-dropcursor`，只保留自绘移动影子、块占位框与邻接元素平移反馈。此处不禁用普通文字的拖动能力或更改 ProseMirror 命令逻辑。

## 文本选区
为可编辑 Tiptap 文本显式指定 `::selection` 和 `::-moz-selection`。与 CodeMirror 源码编辑器共用 `--rk-selection`，由当前主题的 `--color-text-link` 推导，浅色约 27%/深色约 37% 混色强度。保留文字本身的色彩对比与已保存的 RMD 高亮／手绘颜色，文本选区不会创建持久格式。

## 测试
- `pnpm check` 包含更新后的静态命令入口顺序审计，已通过；`pnpm build:web` 已通过；
- `pnpm test` 已通过：287/287、35 套；
- 新增 `scripts/editor-toolbar-selection-v6-e2e.mjs`：用 Edge 检验桌面和 Pad 1024px、iPhone 390px 同序、触控首部固定与块操作、亮/暗选区 computed style、真实 ProseMirror 文本 dragover 生成主题光标、拖动块时只显示自绘占位与影子，临时 Worker 和隔离 D1 自动清理；
- 最终单次连续全量 **29/29 Edge 浏览器 E2E 全部通过（189.3 秒）**，覆盖 V5 原有右键操作、行内功能、Drawer、RMD 复杂容器与嵌套拖拽，以及新增 V6 场景；由测试运行器自动清理临时 Worker/D1。
- 实际 iOS/iPadOS Safari 手势、系统选中文字菜单与不同触控设备仍需真机检验。

本轮直接在现有 E:/Recalloom main 开发，未创建新的工作树或更改线上 Cloudflare 数据。
