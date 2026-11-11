# 本地开发

```bash
pnpm install
cp .dev.vars.example .dev.vars
# 在 .dev.vars 中填写本地测试用 MCP_AUTH_SECRET
pnpm db:local
pnpm dev
```

`pnpm dev` 会监听帮助文档与目录清单的修改，并自动重建 Worker 可导入的帮助模块。单独维护帮助时可运行 `pnpm help:watch`，提交前执行 `pnpm help:check`。MCP 修改记录/文件夹元数据时必须使用最新 `expectedMetadataRevision`；归档、删除与恢复遵循预览、权限和版本冲突约束。数据库升级通过 `migrations/` 的顺序迁移实现，使用 `pnpm test:migrations` 验证本地 D1 的安全升级。

需要验证文档示例实际渲染与编辑行为时，可在本地测试 Worker（已应用本地迁移、监听 `127.0.0.1`）运行的情况下执行 `pnpm test:help:e2e`；可用 `RECALLOOM_TEST_BASE` 指定本地端口。该脚本只允许连接 `127.0.0.1`，并且会在本地测试数据库中创建验证记录；**不可对生产环境执行**。

本地 MCP 地址为 `http://localhost:8787/mcp`。如需开发网页，在另一个终端运行 `pnpm dev:web`，打开 `http://localhost:5173`；它会将 API 请求代理到本地 Worker。运行 `pnpm check`、`pnpm test` 和 `pnpm build:web` 验证更改。

## 编辑器浏览器回归（单命令、隔离环境）

```bash
pnpm test:editor
# 可选：已构建 dist/web，仅运行指定的稳定回归测试
node scripts/run-editor-e2e.mjs icon-system-e2e.mjs
# 可选：不重新构建、运行全部浏览器 E2E
pnpm test:editor:quick
```

运行器会创建一次性本地 D1、应用迁移、选取空闲的 `127.0.0.1` 端口、启动 Wrangler，运行当前维护的核心浏览器回归套件，并在退出时回收子进程与测试数据。测试套件清单以 `scripts/run-editor-e2e.mjs` 为准。

网页登录限流**默认开启**。测试运行器对它启动的本地 Worker 显式注入 `WEB_AUTH_RATE_LIMIT_ENABLED=false`，仅跳过 Cap Challenge、Cap Redeem 和 Login 的**限流计数**，仍要求 Cap.js 验证、合法 Origin、正确 OAuth 密钥、重放保护与有效会话。此开关只有在服务地址为 `127.0.0.1`、`localhost` 或 `::1` 时才生效；公网域名即使误设为 `false` 仍保持限流。日常 `pnpm dev` 不自动关闭保护；如需手动关闭本地开发环境限流，可在被 Git 忽略的 `.dev.vars` 中加入 `WEB_AUTH_RATE_LIMIT_ENABLED=false`。验证限流本身时可用 `RECALLOOM_E2E_PROTECTED=true` 运行单个浏览器脚本，不建议在开启限流时连续跑整套登录测试。

如果要从本地手动部署，请先通过环境变量配置 `RECALLOOM_KV_ID` 和 `RECALLOOM_D1_ID`，再运行 `pnpm deploy`。部署脚本会执行所需的 D1 迁移。不要提交 `.dev.vars` 或本地生成的部署配置。

## Cloudflare Builds 依赖修复

Cloudflare 构建环境曾出现已声明依赖在 pnpm 隔离目录中无法解析的问题，包括 `@uiw/react-codemirror` 对 Babel helper 和 `@codemirror/autocomplete` 对 `@codemirror/state` 的导入。本地及 GitHub Linux CI 的锁文件安装可以正常解析，说明不能仅根据 Vite 的 unresolved import 日志判断是代码忘记声明依赖。

仓库的 `pnpm-workspace.yaml` 设置 `nodeLinker: hoisted`，从干净安装起使用实体依赖目录，避免 Cloudflare 构建阶段丢失 pnpm 虚拟目录间的符号链接；继续保留原有 `allowBuilds` 列表和 `minimumReleaseAgeExclude` 策略。已经在隔离的全新安装目录中验证 `pnpm install --frozen-lockfile --prod=false`、真实 Vite 构建及包体检查。

`pnpm build:web` 会先运行 `scripts/ensure-build-deps.mjs --repair`。普通本地开发和 GitHub CI 先校验 CodeMirror/Babel Runtime 7 解析链，发现断链才尝试 `pnpm install --frozen-lockfile --force --prod=false`。**Cloudflare Workers Builds 额外注入 `WORKERS_CI=1`**：该环境下为了防止 pnpm 安装目录表面完整而 Vite 解析到其他缺失依赖，每次进入 Vite 构建前仅删除当前仓库生成的 `node_modules`，再按照冻结锁文件重建完整 hoisted 依赖树，并检查已知链接。此过程不会删除依赖缓存、Git 文件、数据库或源代码；本地和 GitHub CI 不执行该清理。`pnpm deps:check` 始终只读。

此前实际验证发现：在 pnpm 11.1.3 下单独执行 `pnpm install --force` 可能立即输出 `Already up to date` 而不重建任何模块。只有先清理安装目录，重新安装才确实恢复了全部 685 个依赖包。已在 D 盘隔离副本以 `WORKERS_CI=1` 验证真实完整安装与 Vite 构建。**这属于应对构建环境依赖树异常的恢复措施，并不是对最近一次 Cloudflare 错误模块名的定论。**

如重建后依然失败，检查 Cloudflare Workers 项目的 **Settings → Build → Build cache → Clear Cache** 并重试；必须查看构建日志中预检列出的具体依赖链接。不要把出错模块加进 Rollup `external` 来绕过问题，否则浏览器运行时仍可能缺包。

## 工程检查与测试分层

| 命令 | 验证范围 | 环境要求 |
| --- | --- | --- |
| `pnpm check` | CSS 归属、图标、帮助文档、语法覆盖、前后端类型 | 无远端凭证 |
| `pnpm test` | 使用受控并发运行 Node 单元测试 | 无远端凭证 |
| `pnpm deps:check` | 从实际引用者验证 CodeMirror 与 Babel Runtime 7 的依赖解析链接，捕捉 pnpm 依赖树缺失 | 需要已执行 `pnpm install` |
| `pnpm build:web` | 先检测依赖链接，必要时通过冻结锁文件强制重建，再执行 Vite 前端构建 | 无远端凭证 |
| `pnpm bundle:check` | 检查主入口 JS gzip 不超过 250KiB、全局 CSS gzip 不超过 56KiB，并验证路由/编辑器/RMD 的按需 chunk | 需要先执行 `pnpm build:web` |
| `pnpm test:migrations` | 临时本地 D1 数据迁移回放 | 不接触生产，但可能较慢 |
| `pnpm test:editor` | 使用隔离 Worker/D1 的核心编辑器浏览器 E2E | 本地 `.dev.vars` + 浏览器 |

- `.github/workflows/quality.yml` 在 Push/PR 上先检查 CodeMirror/Babel 依赖链接，再运行静态检查、单元测试、构建及包体预算检查，不执行远端 D1 迁移。
- `scripts/` 中的 E2E 可能属于核心套件或单独的可重复回归测试；单次开发任务的临时脚本应放在被 Git 忽略的 `.agents/`。
- UI 回归不仅验证 SVG 或 DOM 是否存在，还应验证 Computed Style、可见性、尺寸和实际交互。`web-bundle-loading-e2e.mjs` 通过隔离浏览器请求记录确认路由、命令面板与原生滚动条策略不会提前下载功能脚本。
- OAuth、归档/永久删除、关系网和迁移必须在隔离环境进行专项测试，不能用单元测试代替。
- 本地迁移测试会启动隔离的 Wrangler/D1，执行成本高于纯单元测试，因此与快速 CI 分开运行。

## 代码维护约定

参考 [架构与目录说明](architecture.md)、[样式体系](../web/src/styles/README.md) 与 [语义图标规范](../web/src/ICON_SYSTEM.md)。
正式技术规范保持当前有效，不记录单次开发任务或阶段完成情况。新增功能应遵守既有模块责任边界；临时计划、验收截图与一次性测试产物存放在 `.agents/` 或 `docs/_local/`，不要提交。
