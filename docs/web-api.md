# Recalloom Web API（仅后端）

本模块使用 Hono + Cloudflare Workers + D1 + capjs-core；暂无 React 页面，根路径 / 仍返回服务状态 JSON。现有 /mcp 与 OAuth 路由保持原样。Web 和 MCP 共用 storage.ts / agent-tools.ts 的数据与版本管理。

## 初始化

Web 登录与现有 MCP OAuth 授权使用同一个 `MCP_AUTH_SECRET`，**不需要 `WEB_ADMIN_SECRET`、另一个登录密码或 `pnpm web:key`**。登录时，用户将现有 OAuth 密钥直接输入 Web 登录表单，经同源 HTTPS 的 `POST /api/auth/login` 发送，服务端与运行时 Secret 验证。密钥仅在登录时提交，不存储于浏览器持久化存储、D1 或前端源码，不应被日志记录。推荐使用至少 32 字符的高熵随机主密钥，但不会要求现有实例立刻轮换。

服务器内部使用 `HMAC-SHA256(master=MCP_AUTH_SECRET, message='recalloom:web:v1:'+purpose)` 派生仅供服务端使用的 `cap`、`proof`、`session`、`rate`、`nonce` 子密钥；**不派生用户登录密码**。Session 由服务器签发随机 256-bit Token，仅将 `session` 子密钥参与计算的 Token HMAC 哈希存入 D1。轮换 OAuth 主密钥会使现有 Web 会话失效。

`pnpm db:local` 负责本地数据库迁移；生产 `pnpm deploy` 会执行远程迁移 `0007_web_auth.sql`。生产只需像之前一样配置 `MCP_AUTH_SECRET`，无需添加新的 Secret。

## 登录过程

1. POST /api/auth/cap/challenge，携带同源 Origin 和 JSON {}，接收 capjs-core 的 Challenge。
2. POST /api/auth/cap/redeem，发送 Cap 求解结果 token、solutions，服务端通过 D1 原子消费 nonce，返回短期 capToken。
3. POST /api/auth/login，JSON 包含 `secret`（原始 `MCP_AUTH_SECRET`，与 OAuth 授权页输入相同）和 `capToken`；capToken 使用一次即失效（错误密钥也会消费）。成功后以 Set-Cookie 下发 256-bit 随机 Session Token；后续 CRUD 不再携带 OAuth 密钥。
4. Cookie 名 __Host-recalloom_session，属性 HttpOnly、Secure、SameSite=Strict、Path=/；Token 不通过 JavaScript/localStorage 获取。后续 API 自动携带 Cookie，不再重复提交密钥。
5. D1 只保存使用 `session` 子密钥计算的 HMAC Token 摘要和会话信息；OAuth 主密钥轮换后旧会话失效。会话最多持续 7 天，12 小时无访问过期；5 分钟节流 `last_seen_at` 更新。
6. POST /api/auth/logout 注销当前会话；GET /api/auth/session 获取登录状态；GET /api/auth/sessions 列出会话；DELETE /api/auth/sessions/:id 撤销会话。
Cap PoW 加 D1 限速只能提高攻击成本。公网仍应通过 Cloudflare Rate Limiting/WAF 减轻恶意请求引发的 D1 写入。

## CRUD 路由

| 方法 | 路径 | 功能 |
| --- | --- | --- |
| GET, POST | /api/folders | 目录浏览（parentId、limit、cursor）和创建 |
| PATCH | /api/folders/:id | 文件夹元数据/移动，需 expectedMetadataRevision |
| GET | /api/paths?path=/... | 解析虚拟路径 |
| POST | /api/records | 创建文档、checkpoint 或 task_list |
| GET | /api/records/:id | 当前或历史内容，可带 revision、metadataOnly、lineStart、maxLines |
| PATCH | /api/records/:id/content | 编辑正文，需 expectedRevision，可选 dryRun |
| PATCH | /api/records/:id/meta | 更名、移动、修改状态、归档，需 expectedMetadataRevision |
| POST | /api/records/:id/tags | 标签 add/remove |
| GET | /api/records/:id/versions | 历史记录 |
| GET | /api/records/:id/diff?from=1&to=2 | 版本差异 |
| POST | /api/records/:id/restore | 恢复历史 Revision |
| GET, POST | /api/records/:id/links | 读取/维护关联 |
| GET | /api/tasks | 查询结构化 TODO |
| POST | /api/tasks/mutate | add、update、remove，需 expectedRevision |
| GET | /api/search | metadata/literal/semantic/hybrid/auto 检索 |
| GET | /api/activity | 审计事件 |
| GET | /api/tags | 标签统计 |
| GET | /api/context | 项目上下文 |
| GET | /api/index | 索引状态 |

列表统一返回 items 和 page。Web 操作者为 web:owner:<sessionId>，MCP 仍按 grant:<actorId> 审计。当前删除只能使用归档状态，没有不可恢复的永久 DELETE，回收站设计留待后续。

## 安全协议

所有非安全方法必须是同源请求（Origin 与 Sec-Fetch-Site 校验），私有数据 API 拒绝无 Cookie 请求并使用 Cache-Control: no-store。不会启用带凭据跨域 CORS。HTTP 400 表示输入错误，401 未登录，403 来源或 PoW 验证失败，404 不存在，409 Revision/CAS 冲突。Web Cookie 不可访问 MCP OAuth API。
新建 web_sessions、web_nonces、web_rate_limits 三张 D1 表；Cap Challenge 与证明使用 HMAC 用途隔离。定时清理过期记录。私有响应不可缓存。前端将来渲染 Markdown 必须防 XSS。

## 端到端测试（仅本地隔离环境）

先运行 `pnpm db:local`，然后在本地启动带有**测试用** `MCP_AUTH_SECRET` 的 `wrangler dev` Worker，使用 `node scripts/web-api-e2e.mjs` 测试。脚本仅使用**固定的本地测试 OAuth 密钥**登录，严禁使用生产密钥运行，且严禁针对生产数据库运行写入型测试。
测试覆盖：Challenge、PoW Proof 及重放限制、两个并发登录仅有一次成功、跨站写入防护、Cookie Session、目录/记录/标签/任务/检索、Revision 冲突、历史恢复、审计、Session 撤销和 MCP 授权隔离。

本文件记录已实现的后端功能；尚未开发 CSR 页面。生产已经使用原有 `MCP_AUTH_SECRET`，不需要设置额外 Web Secret。