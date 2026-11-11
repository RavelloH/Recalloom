# Recalloom 样式架构

本目录维护应用统一的 CSS 所有权。`web/src/main.tsx` 只加载全局 `styles/index.css`；关系网、文档关联、记录、RMD 和编辑器功能样式由具体路由/组件按需加载。Astryx reset / 组件 / neutral-theme CSS 仍在全局入口之前导入。项目不使用 Tailwind，不再用后置覆盖文件叠加修补。

## 模块所有权

| 模块 | 职责 |
| --- | --- |
| foundation/tokens.css | Recalloom 语义颜色、字号、间距、动画与图标尺寸变量 |
| foundation/base.css | HTML 元素级基础规则与非组件通用辅助类 |
| layout/shell.css | 应用外壳、导航、侧栏、顶栏、滚动容器、文件树、移动端底栏 |
| layout/pages.css | 页面框架、页面标题、面包屑、页面操作区 |
| components/library.css | 文件列表、知识库目录、归档入口 |
| components/search.css | 搜索表单、搜索结果及匹配反馈 |
| components/tasks.css | 任务列表及状态 |
| components/dashboard.css | 概览、最近访问、活动与统计 |
| components/collections.css | 集合的共用样式与其它清单组件 |
| components/forms.css | 表单、字段、属性与创建操作 |
| components/status.css | 错误、警告、成功与进度状态 |
| components/controls.css | 通用按钮、标签、卡片等控件 |
| components/overlays.css | 对话框、弹窗、命令面板、登录与遮罩 |
| features/rmd.css | RMD 块、标注、扩展语法的显示行为（由记录编辑器和 Markdown 预览加载） |
| features/editor-chrome.css | 可视化编辑器工具栏与浮动操作（由记录编辑器加载） |
| features/records.css | Record 页面与其余编辑器外围样式（随记录页面加载） |
| features/document.css | Markdown、文档排版与内容呈现 |
| features/graph.css | 关系图、图谱检查器（随关系网页面加载） |
| features/relations.css | 文档关系面板（由关系网页面与记录关联组件加载） |
| features/wiki.css | Wiki 专有界面 |
| features/motion.css | 动画定义、全局运动与过渡 |
| icons.css | 统一 Icon SVG 方格与 Astryx Banner 图标槽兼容；不再使用包装层 |

编辑器、聊天等组件自身导入的局部 CSS（如 tiptap/editor.css、rmd-chat.css、block-handle.css）继续独立维护，不能用它们当做全局补丁。

## 核心规则

1. 一个选择器只允许有一个全局文件负责。默认、响应式、悬停、选中和禁用状态放在相同的所有权模块内。不要增加以加载顺序覆盖既有组件的全局补丁层。
2. 视觉语义用设计变量表示；布局尺寸与真实容器有关，不能机械强制统一。
3. 避免依赖第三方 DOM 内部结构。侧栏使用统一 NavRow，调整图标与按钮布局时应同步验证 SVG 图标槽和文字对齐。
4. 不要依靠 import 顺序解决同一个选择器的分歧，应修改唯一所属模块。不得随意新增 !important。
5. UI 常用字级使用 --rk-font-caption、--rk-font-small、--rk-font-label、--rk-font-body、--rk-font-control。Markdown 正文、数学、图谱小标签允许独立尺寸。
6. 标注、搜索匹配与危险边框的固定语义色使用 token，不再跨多个文件复制十六进制值。

## 输入能力与布局是正交条件

- 鼠标悬停才有意义的反馈，使用 @media (hover: hover) and (pointer: fine)。
- 无悬停/粗指针使用 (hover: none) 或 (pointer: coarse)，确保关键操作有可见入口或键盘焦点方式，不仅藏在 :hover 后面。
- 720px 手机底栏、1000px 多列折叠等仅表示空间约束，可用 viewport 查询或 container queries；不能用它们来判断是不是手机、平板或电脑。
- 1024px 的 iPad 使用触屏粗指针时应保持宽布局，但不出现只能依靠鼠标 hover 操作的入口。
- 纯视觉 hover 颜色可以保留，但不能让 touch 用户丢失关键功能。

## Astryx 与 CSS 优先级

Astryx 样式在全局入口之前导入，保持组件原有交互、可访问性、图标槽。
尚未使用全局 @layer：第三方 CSS 尚未纳入层级体系时，贸然给应用规则加 layer 会让未分层的第三方规则覆盖业务样式。

!important 仅保留第三方强制覆盖、个别动画与确实必要的例外。遇到优先级问题应使用浏览器 Computed Styles 查实际生效值。

## 验证

- pnpm styles:check：全局或按需模块注册、指定组件入口、重复所有权、交互特征查询、必要 tokens、!important 基线检查。
- pnpm bundle:check：生产构建后验证全局 CSS gzip 预算，以及图谱、记录和编辑器 CSS 未误并入全局入口。
- pnpm check：集成样式、图标、帮助、语法与 TypeScript 检查。
- pnpm build:web：Vite 样式与资源打包。
- node scripts/run-editor-e2e.mjs editor-responsive-v5-e2e.mjs editor-toolbar-v4-e2e.mjs editor-block-handle-e2e.mjs：验证编辑器、触屏 iPad 与手机交互。导航和按钮改动需继续加对应布局 E2E。
