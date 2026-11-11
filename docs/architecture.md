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

## 边界原则

1. **业务逻辑不依赖 React。** 记录身份、版本、归档、安全性和搜索准则优先在 Worker/共享纯模块实现；UI 不应重写安全校验。
2. **服务器 API 是唯一权威入口。** 前端只能通过 API 读取/修改持久状态，不直接访问 D1、KV 或 Vectorize。
3. **编辑器输入和持久层分离。** 源码、预览、可视化三种模式要保持语义一致，编辑器中间态可延迟保存但不能丢失修订冲突检查。
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
