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
| `src/` | Worker 服务端、OAuth、MCP、Web API、存储、搜索与生命周期 |
| `src/help/` | 可供 MCP 查询的帮助文档及生成源 |
| `src/rmd/` | RMD 语法/组件注册元数据与共享契约 |
| `web/src/` | 前端路由、知识库、记录编辑器、任务、关系图谱及视图组件 |
| `web/src/tiptap/` | Tiptap 扩展和编辑器交互 |
| `web/src/styles/` | 已模块化的样式所有权与设计令牌，详见该目录 README |
| `migrations/` | 顺序执行的 D1 SQL schema 迁移；禁止修改已上线迁移内容 |
| `test/` | Node 单元测试，包含纯逻辑和 React 静态渲染验证 |
| `scripts/` | 可重复使用的浏览器回归、隔离运行器、构建及质量检查脚本 |
| `docs/` | 当前有效的技术规范、部署与开发说明，以及可复制的语法示例 |

## 边界原则

1. **业务逻辑不依赖 React。** 记录身份、版本、归档、安全性和搜索准则优先在 Worker/共享纯模块实现；UI 不应重写安全校验。
2. **服务器 API 是唯一权威入口。** 前端只能通过 API 读取/修改持久状态，不直接访问 D1、KV 或 Vectorize。
3. **编辑器输入和持久层分离。** 源码、预览、可视化三种模式要保持语义一致，编辑器中间态可延迟保存但不能丢失修订冲突检查。
4. **数据库变更可回放。** 新增 migrations 文件，不对历史迁移做破坏性重写；复杂升级必须在本地 D1 的多个旧状态上回归。
5. **组件和 CSS 有明确归属。** 功能组件遵循现有职责边界；共享 CSS 使用 `web/src/styles/` 的单一所有权规则，避免全局补丁文件。
6. **文档与代码同步。** 帮助源位于 `src/help/`，修改后运行 `pnpm help:generate` 并通过 `pnpm help:check`；RMD 组件与编辑器命令的入口由语法审计覆盖。

## 测试金字塔

- 每次 Push / PR：`pnpm check`、`pnpm test`、`pnpm build:web`。这些步骤不需要访问生产 Cloudflare。
- 本地隔离集成：`pnpm test:editor`，用临时 Worker + D1 检查关键可视化交互。
- 高风险专项：OAuth、Web API、归档/删除、Wiki/关系网、数据库迁移，各自有独立 E2E / 迁移脚本。
- UI 变更应测试实际 Computed Styles、模式切换、键盘和触屏能力，不仅是组件存在性。

已完成的局部设计规范：[全局 CSS](../web/src/styles/README.md) / [语义图标](../web/src/ICON_SYSTEM.md) / [RMD 渲染与安全](rich-markdown.md)。
