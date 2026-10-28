# Recalloom

**Versioned context storage for AI agents.**

Recalloom 是一个基于 Cloudflare 的开源自部署 MCP 文本库，帮助 Agent 跨会话准确查找和更新上下文。支持虚拟文件夹、标签、精确文本编辑、结构化 TODO、历史版本和语义检索。

## 功能与架构

- **MCP + OAuth**：Streamable HTTP，使用授权密钥批准客户端；通过动态客户端注册（DCR）兼容 ChatGPT 等客户端，提供 `notes:read` / `notes:write` 权限。
- **D1**：唯一的业务事实源；记录元数据、文件夹、当前文本、历史差分、TODO、增量变更。
- **text-version**：最新快照与历史反向差分分表存储；历史恢复创建新修订，不破坏原历史。
- **严格编辑与恢复**：全文、追加、精确替换、批量替换、Unified Diff、按行修改；支持 `expectedRevision`、`dryRun`、版本差异查看；TODO 历史恢复同步重建任务投影。
- **Agent 协作**：元数据独立修订号与冲突保护、结构化变更事件、批量读取、递归项目上下文、标签索引和记录关联。
- **Vectorize + Workers AI**：异步构建当前正文语义索引；正文与标签仍以 D1 为准。索引任务有租约和超时重试，避免 Worker 中断后永久滞留。
- **备份与还原**：分页 `export_snapshot` 输出包含历史差分与审计信息的 JSON；`import_snapshot` 默认 `dryRun`，不会覆盖已有 ID。
- **Workers KV**：仅存放 OAuth 状态。无需 R2 或 Durable Objects。

MCP 工具包括基础目录/文档管理、任务、标签、版本、语义搜索与索引状态；扩展工具提供 `read_many`、`diff_revisions`、`list_tags`、`list_links`、`manage_link`、`project_context`、`export_snapshot`、`import_snapshot` 和 `index_diagnostics`。

## 本地开发

需要 Node.js 24 和 pnpm 11。

```bash
pnpm install
cp .dev.vars.example .dev.vars
# 在 .dev.vars 中设置随机的 MCP_AUTH_SECRET
pnpm db:local
pnpm dev
```

本地 MCP 地址：`http://localhost:8787/mcp`。运行 `pnpm check` 和 `pnpm test` 检查代码。

OAuth 使用 DCR，而不依赖客户端 ID 元数据文档（CIMD）下载；部分客户端的元数据服务器可能拒绝 Worker 出站请求（HTTP 403）。如果从旧的 CIMD 配置升级，请在 MCP 客户端中删除原连接后重新建立，以便自动执行 DCR 注册。

Vectorize/Workers AI 需要远程资源才能进行真实语义检索；纯文本、D1、版本及 TODO 相关功能可以在本地测试。升级 MCP 工具后，客户端可能需要刷新或重新连接才能发现新工具和参数。

## Cloudflare 部署和 GitHub 自动构建

本仓库保留 **占位的 KV/D1 ID**，不会提交任何 Cloudflare 账户专属配置。部署时通过构建环境变量生成被 Git 忽略的 `wrangler.deploy.jsonc`。

### 1. 创建资源

登录 Cloudflare 并创建三种资源：

```bash
pnpm exec wrangler login
pnpm exec wrangler kv namespace create OAUTH_KV
pnpm exec wrangler d1 create recalloom
pnpm exec wrangler vectorize create recalloom --dimensions=1024 --metric=cosine
```

保存创建命令返回的 KV namespace ID（32 位十六进制）和 D1 database ID（UUID）。Vectorize 名称必须为 `recalloom`，且使用 1024 维与 cosine。已有同名资源时直接使用现有资源，不要重复创建。

### 2. 连接 Cloudflare Workers Builds

在 Cloudflare Dashboard → **Workers & Pages → Create application → GitHub**，选择本仓库：

| 设置 | 值 |
| --- | --- |
| Worker name | `recalloom` |
| Root directory | `/` |
| Production branch | `main` |
| Build command | `pnpm check && pnpm test` |
| Deploy command | `pnpm deploy` |
| Preview builds | 建议暂时关闭；不要让预览分支意外访问正式 D1 |

在 **Settings → Build → Build Variables and Secrets** 添加构建变量：

| 变量 | 值 |
| --- | --- |
| `RECALLOOM_KV_ID` | 创建 KV 时返回的 Namespace ID |
| `RECALLOOM_D1_ID` | 创建 D1 时返回的 Database ID |

它们是资源标识符，不是 OAuth 密钥。Wrangler 部署脚本将检查变量，按序执行 D1 远程迁移、部署 Worker；任一步失败会停止部署。后续每次 push 到 `main` 都会重新构建并部署。Cloudflare Workers Builds 默认创建构建 API Token；如果执行 D1 迁移时报权限不足，需为构建选择拥有目标 D1 编辑和 Workers 部署权限的 Token。

### 3. 设置运行时密钥

首次创建 Worker 后，在 Worker 的 **Settings → Variables and Secrets** 中添加类型为 **Secret** 的 `MCP_AUTH_SECRET`（高强度随机值），不要放在 Build Variables、GitHub 仓库或 `wrangler.jsonc`。此外推荐为 `/authorize` 和 `/oauth/register` 配置 WAF Rate Limiting，分别防范授权口令猜测和恶意客户端注册造成的 KV 写入消耗。

如需自定义域名，可在 Worker 中配置 Custom Domain，并设置 `MCP_BASE_URL` 为完整的公共 origin（不包含 `/mcp`）；否则使用默认 `workers.dev` 地址即可。

MCP 地址为 `https://<你的 Worker 域名>/mcp`。

### 本地手动部署

```bash
# 先将两个资源 ID 以 RECALLOOM_KV_ID、RECALLOOM_D1_ID
# 环境变量的形式提供，再运行：
pnpm deploy
```

不要提交 `.dev.vars`、`wrangler.deploy.jsonc` 或本地数据文件。

## 数据与安全

- 每个记录使用稳定 ID；移动和重命名不会改变记录身份。
- 普通文本和结构化任务在同一次 D1 事务中提交当前状态与新修订；过期版本编辑会拒绝写入。
- `manage_record` 和 `manage_folder` 可以携带 `expectedMetadataRevision`，以独立于正文的元数据修订号进行 CAS；无变化的操作不会产生额外事件。
- 浏览、TODO 与版本历史支持分页；递归项目上下文可控制深度和字符预算。
- `record_contents` 保存当前全文，`record_histories` 保存差分数据，`revisions` 保存审计元数据。
- 语义索引异步更新，可能短暂落后；搜索返回的向量命中会经过 D1 版本验证。
- 本服务默认面向单一所有者，所有获授权的客户端访问同一个知识库。务必保护授权密钥，并定期备份 D1。
- `export_snapshot` 需要沿 `nextCursor` 收集所有页面；恢复时先导入含文件夹的首页，再导入后续记录与关联。每页导入前建议使用 `dryRun` 检查；多个页面不构成跨请求原子事务，应在写入停止期间执行备份/恢复。
- 数据备份包含历史内容和元数据，可能含敏感信息；请加密保存，不要上传到公开仓库。

## 运行注意事项

索引任务完成不等于 Vectorize 数据立即可查询，语义搜索仍需考虑传播延迟；即时精确检索可使用 D1 子串模式。索引租约默认五分钟，超过最大重试次数的任务会保留失败状态以供检查。元数据与正文使用独立的修订控制，建议 Agent 在修改前读取当前版本号。

## License

MIT.
