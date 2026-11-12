# Recalloom 工程架构与目录约定

本文描述当前代码中的模块职责、数据流和约束。Cloudflare Worker、Web 控制台和 MCP 使用同一套业务数据与授权边界。

## 系统组成

```text
Cloudflare Worker (src/index.ts)
├── OAuth 授权与 Web 会话
├── Web API (src/web-api.ts)
├── MCP 工具 (src/mcp.ts / src/agent-tools.ts)
├── D1：记录、关系、版本、归档、审计
├── KV：OAuth 相关状态
├── Vectorize / Workers AI：异步索引与语义检索
└── ASSETS：Vite 构建的 web/ 前端

web/src：React + TanStack Router/Query + Tiptap + Astryx
└── 浏览器通过同源 API 调用 Worker；RMD 语法以 src/rmd/registry.json 为基准
```

## 当前仓库结构

| 路径 | 责任与边界 |
| --- | --- |
| `src/` | Worker 服务端、OAuth、MCP、Web API、搜索与生命周期 |
| `src/storage.ts` | 存储层稳定 API 兼容出口；业务调用方不应直接依赖内部实现 |
| `src/storage/` | 文件夹与目录、记录读取、修订历史、元数据、任务、归档、审计事件和私有工具 |
| `src/help/` | 可供 MCP 查询的帮助文档及生成源 |
| `src/rmd/` | RMD 语法/组件注册元数据与共享契约 |
| `web/src/` | React 前端、编辑器、关系网、组件与路由入口 |
| `web/src/pages.tsx` | 页面组件兼容导出入口，供非路由调用方继续使用 |
| `web/src/pages/` | 登录、概览、知识库、归档、记录、任务、搜索、活动和设置页面；`router.tsx` 通过 `lazyRouteComponent` 按需加载，`shared.tsx` 提供通用页面反馈组件 |
| `web/src/record-workbench.tsx` | Markdown 文档工作台顶部：文件名（显示时隐藏 `.md`）、更新时间/编辑者/字数信息、信息/目录/关联/版本统一检查器；文件名仅在顶部编辑（任务列表不受影响） |
| `web/src/document-heading.ts`、`web/src/document-filename.ts` | Markdown 字数统计与文档文件名显示/重命名规则；所有 H1 均属于正文，不再提升到标题栏 |
| `web/src/record-editor.tsx` | 源码、预览、可视化三种模式均显示与编辑完整 Markdown 草稿（包括首个 H1）；版本列表通过 Portal 进入检查器 |
| `web/src/visual-editor.tsx` | 可视化编辑器稳定入口，保持默认组件导出与 `VisualEditorHandle` 类型导出 |
| `web/src/visual-editor/` | 可视化编辑器装配、Tiptap 扩展组合、选区状态、共享格式工具栏、表格操作、斜杠/引用补全与弹出菜单 |
| `web/src/tiptap/` | Tiptap 节点、命令、插件与编辑器交互原语，不包含页面级工具栏布局 |
| `web/src/shell.tsx` | 始终可见的导航与工作区布局；命令面板首次调用时加载，随后保持挂载 |
| `web/src/scrollbars.tsx` | 滚动条策略与实例生命周期；仅在非原生滚动条环境中异步导入 OverlayScrollbars |
| `web/src/styles/` | 样式所有权与设计令牌；全局入口和功能按需 CSS 并行维护，详见该目录 README |
| `migrations/` | 顺序执行的 D1 SQL schema 迁移；禁止修改已上线迁移内容 |
| `test/` | Node 单元测试，包含纯逻辑和 React 静态渲染验证 |
| `scripts/` | 可重复使用的浏览器回归、隔离运行器、构建及质量检查脚本 |
| `docs/` | 当前有效的技术规范、部署与开发说明，以及可复制的语法示例 |

## 页面导航与动效

- **路由层：** TanStack Router 使用 `defaultViewTransition.types` 为每次导航判断共享标题是否具备配对资格，覆盖点击、程序导航与前进/后退。`:root { view-transition-name: none }` 禁止全屏快照：侧栏、顶栏和底栏保持实时 DOM。固定尺寸的 `.main-scroll-host` 始终有 `rk-route-content` 快照，保留原来的 130ms 淡出与延迟 105ms 的 175ms 淡入；只有符合严格条件时，额外增加单个 `rk-shared-title` 快照。**桌面顶栏由路由页面通过 Portal 填充，必须绝对定位，不参与 `.workspace` 的 flex 高度计算；所有桌面 `.page`（无论是否有面包屑）统一预留顶部内容间距，留白属于可滚动的页面内容，不是固定空顶栏。** 否则从概览进入详情时 `:empty` 导致顶栏由 `display:none` 变为 `flex`，会把仍在淡出的旧页面整体推移，造成闪动。不要把过渡名称赋给页面内容节点，也不要对 `root` 恢复截图。
- **文字与共享元素：** 共享快照只支持知识库文件列表↔Markdown 文档标题、知识库文件夹列表↔文件夹标题两种关系。`web/src/shared-view-transition.ts` 在路由提交前检查双方资源 ID 与实际纯名称一致、目标查询缓存就绪、来源 DOM 唯一且位于可视区域，并排除截断、正在编辑或仍在入场的标题；从详情返回还要确认之前的列表来源、初始滚动和目标列表中真实存在对应记录。临时为一个资源的两端赋予 `rk-shared-title`，浏览器过渡 `finished` 后清理标记；其余文字跟随页面快照。禁用全局 ID 永久命名，也不对孤立快照做强制隐藏。所有搜索、最近访问、任务列表和不满足条件的导航只使用原始整页渐变。
- **文件名与 H1：** 知识库的 Markdown 文件名单独拆成 `.file-row-title`（去 `.md` 的纯名称）与 `.file-row-extension`（不可共享的 `.md`），只有前者可与工作台顶部文件名标题配对。正文中的 H1 不参与导航动画。共享标题位置过渡约 260ms，旧、新文字分别淡出和淡入，避免把文件行背景、图标及扩展名一起拉伸。参考 `web/src/record-workbench.tsx` 与 `web/src/styles/features/motion.css`。
- **页面就绪：** `router.tsx` 不再使用旧的 600ms 预热截止时间。文档/任务等内容路由的 loader 在提交前准备关键首屏查询和懒加载组件，避免 Skeleton 进入新页面快照。**搜索例外：** 搜索页路由只预加载页面模块，不等待搜索 API；点击搜索或切换搜索方式要立即更新 URL、展示加载提示和按钮反馈，再以原有 `Swap` 和结果行渐入呈现结果。命令面板首次点击若需下载资源会没有可见动画，因此 Shell 空闲时预热命令面板并保留加载反馈，真实弹窗交由 Astryx Dialog 执行过渡。登录页不提前下载该模块。慢网络时其他路由保留旧页面及导航进度；加载失败由页面错误组件处理。**局部效果：** 检查器 Tab 用 Motion Layout，编辑器模式、侧栏折叠、块拖动继续使用专用动画，所有效果遵守 `prefers-reduced-motion`。
- **刷新加载稳定性：** 首页的未完成事项与近期活动、任务页与活动页在异步数据首次就绪时直接渲染最终结果，不叠加 `Swap → AutoTransition → AutoResizer` 的先退出后进入与高度补间；归档的直接渲染方式是基线。数据仍由共享 TanStack Query 缓存管理。**保留数据行 `data-row-fade-in` 的错峰动画，不要通过删除动画掩盖重复播放。** `OverlayScrollbars` 初始化会重新挂接已存在的滚动容器，导致里面所有 CSS 入场动画重新启动；在非 Apple WebKit 浏览器里，`prepareScrollbars()` 与 React/认证请求**并行**启动；只延迟已认证主界面的 `Shell` 挂载，登录界面和连接提示无需等待滚动条。`OverlayScroll` 在 layout effect 使用已预热的引擎同步初始化，使 DOM 重组发生在首帧绘制前。若引擎下载失败或超过 3 秒仍未就绪，本次页面生命周期固定退回原生滚动条，绝不能在内容已经入场后再升级重组 DOM。Apple WebKit 默认使用原生滚动条而不下载该模块。E2E 将滚动条 chunk 人为延迟 1.5 秒验证连接提示及时显示、列表动画只执行一次，并测试资源错误与超时的原生回退。侧栏文件夹通过按需查询等待实际子项加载，先将真实子树挂载在折叠容器内，随后于独立动画帧展开；关闭时保留 DOM 到收起动画完成，缩减动态效果和动画被打断时有兜底卸载。不要在展开时先显示短暂的“加载中…”子行，导致内容二次撑开。
- **验证：** `pnpm check`、`pnpm build:web`、`pnpm bundle:check`、`node scripts/run-editor-e2e.mjs view-transitions-e2e.mjs shared-title-e2e.mjs`。E2E 使用隔离的本地 Worker/D1，核对旧/新快照始终包含 `rk-route-content`，合格导航额外且仅额外配对一个 `rk-shared-title`；验证 `.md` 不参加共享、动画完成后标记清理、无配对时回退整页渐变、外壳实时、双向历史、手机视口与 1.7 秒延迟 API。WebKit 可用 `RECALLOOM_TEST_ENGINE=webkit`，独立手机会话再设置 `RECALLOOM_TEST_MOBILE=1`；本地 HTTP 不支持生产的 `__Host-` 安全 Cookie，测试脚本仅在回环地址转发本地会话，请勿将此处理加入线上代码。

## 边界原则

1. **业务逻辑不依赖 React。** 记录身份、版本、归档、安全性和搜索准则优先在 Worker/共享纯模块实现；UI 不应重写安全校验。
2. **服务器 API 是唯一权威入口。** 前端只能通过 API 读取/修改持久状态，不直接访问 D1、KV 或 Vectorize。
3. **编辑器输入和持久层分离。** 源码、预览、可视化三种模式要保持语义一致，编辑器中间态可延迟保存但不能丢失修订冲突检查。文档页面采用文件名与正文标题分离的模式：顶部大标题始终显示文件名（隐藏末尾 `.md`），在此编辑只更新文件名元数据，不修改 Markdown；首个与其他位置的 H1 一律作为正常正文，在源码、预览和可视化中完整显示，字号小于顶部文件名。类型标识不重复显示文件名，详情检查器不提供第二个文件名编辑入口。标签独占可选行，更新时间/去重编辑者/可见字数与详情按钮共用下一行。完整属性、目录、关联和历史在一个检查器中按需展示。块拖动把手继续沿用现有统一交互，不随页面布局调整。
4. **数据库变更可回放。** 新增 migrations 文件，不对历史迁移做破坏性重写；复杂升级必须在本地 D1 的多个旧状态上回归。
5. **组件和 CSS 有明确归属。** 页面模块使用 `web/src/pages/`，可视化编辑器装配使用 `web/src/visual-editor/`，通用 Tiptap 插件使用 `web/src/tiptap/`，服务端存储使用 `src/storage/`。CSS 由 `web/src/styles/` 的单一所有权规则管理，避免全局补丁文件。
6. **公共入口稳定，内部依赖无环。** `pages.tsx`、`visual-editor.tsx`、`storage.ts` 是兼容导出入口，内部模块不得反向引用这些入口或形成循环。`pnpm modules:check` 自动验证三个领域的导出及依赖图。编辑器源码审计分别检查 `visual-editor/formatting-toolbar.tsx` 与 `visual-editor/editor.tsx`，保证桌面和触屏格式菜单共用同一顺序。
7. **按用户意图分割前端资源。** 路由页、知识图谱、编辑器、命令面板等不应由 `main.tsx` 或 Shell 静态导入。页面跳转由 TanStack Router 按导航意图预加载；Apple WebKit 原生滚动条模式不加载 JS 滚动条引擎。使用 `pnpm bundle:check` 保证独立 chunk 与初始 JS gzip 预算（250KiB）、全局 CSS gzip 预算（56KiB），通过隔离 E2E 验证真实资源请求；图谱、关联面板、记录、RMD 和编辑器样式归功能组件所有，按需加载。
8. **文档与代码同步。** 帮助源位于 `src/help/`，修改后运行 `pnpm help:generate` 并通过 `pnpm help:check`；RMD 组件与编辑器命令的入口由语法审计覆盖。

## 测试金字塔

- 每次 Push / PR：`pnpm check`、`pnpm test`、`pnpm build:web`、`pnpm bundle:check`。这些步骤不需要访问生产 Cloudflare。
- 本地隔离集成：`pnpm test:editor`，用临时 Worker + D1 检查关键可视化交互。
- 高风险专项：OAuth、Web API、归档/删除、Wiki/关系网、数据库迁移，各自有独立 E2E / 迁移脚本。
- UI 变更应测试实际 Computed Styles、模式切换、键盘和触屏能力，不仅是组件存在性。

已完成的局部设计规范：[全局 CSS](../web/src/styles/README.md) / [语义图标](../web/src/ICON_SYSTEM.md) / [RMD 渲染与安全](rich-markdown.md)。
