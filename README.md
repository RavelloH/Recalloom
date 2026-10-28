# Recalloom

**让 AI Agent 在不同会话之间准确恢复、查找和维护项目上下文。**

Recalloom 是一个可自部署的版本化知识库，通过 MCP 连接 ChatGPT 等客户端。你可以把项目决策、开发进度、笔记和待办长期保存在自己的 Cloudflare 账户中，让 Agent 在新会话中找到已有资料，而不必反复从头说明。

## 功能

- **跨会话上下文**：按文件夹组织文档与项目 Checkpoint，快速恢复之前的工作进度。
- **结构化任务**：保存 TODO、优先级和任务状态，支持 Agent 持续维护。
- **多种检索方式**：支持关键词、语义和混合搜索，以及标签、关联记录和项目范围查找。
- **版本历史**：保留记录修改历史，支持差异查看、冲突保护和恢复旧版本。
- **协作与审计**：追踪 Agent 的修改，避免不同客户端无意覆盖彼此的工作。
- **备份与恢复**：提供知识库快照导出和恢复前检查，便于迁移与备份。
- **安全连接**：使用 OAuth 授权 MCP 客户端，可分别授予读取与写入权限。

Recalloom 也提供受保护的 Web 管理 API，可访问同一份记录与任务。**目前尚无可视化网页控制台**，日常管理主要通过 MCP 客户端完成。

## 部署到 Cloudflare

需要 Cloudflare 账户，以及 **Workers、D1、KV、Vectorize 和 Workers AI**。本地构建需要 Node.js 24 与 pnpm 11。

### 1. 创建资源

安装依赖并登录 Cloudflare：

```bash
pnpm install
pnpm exec wrangler login
```

在自己的账户中创建资源：

```bash
pnpm exec wrangler kv namespace create OAUTH_KV
pnpm exec wrangler d1 create recalloom
pnpm exec wrangler vectorize create recalloom --dimensions=1024 --metric=cosine
```

保存命令返回的 **KV Namespace ID** 和 **D1 Database ID**。如果资源已存在，直接使用现有资源，不要重复创建。项目会通过 Wrangler 配置绑定 Workers AI。

### 2. 配置自动部署

在 Cloudflare Dashboard 中将 GitHub 仓库连接至 **Workers Builds**，使用以下设置：

| 设置 | 值 |
| --- | --- |
| Worker 名称 | `recalloom` |
| 根目录 | `/` |
| 生产分支 | `main` |
| Build command | `pnpm check && pnpm test` |
| Deploy command | `pnpm deploy` |

在 **Build Variables and Secrets** 中填写资源标识：

| 变量 | 值 |
| --- | --- |
| `RECALLOOM_KV_ID` | 第一步得到的 KV Namespace ID |
| `RECALLOOM_D1_ID` | 第一步得到的 D1 Database ID |

这两个值是 Cloudflare 资源 ID，**不是登录密钥**。

Worker 创建后，在其 **Settings → Variables and Secrets** 中添加运行时 **Secret**：

- `MCP_AUTH_SECRET`：用于批准 MCP 客户端授权，也用于 Web 管理 API 登录。请使用高强度随机值，妥善保管。

不要把密钥放进 GitHub 仓库、Build Variables 或公开配置文件。连接仓库后，对 `main` 分支的提交会触发构建和部署。若需要自定义域名，可在 Worker 中配置 Custom Domain，并按需将 `MCP_BASE_URL` 设为公共站点的 Origin（不包含 `/mcp`）。

### 3. 连接 MCP 客户端

部署完成后，在支持 Streamable HTTP MCP 和 OAuth 的客户端中添加：

```text
https://<你的 Worker 域名>/mcp
```

首次连接会打开 OAuth 授权页面。使用上面设置的 `MCP_AUTH_SECRET` 授权客户端，并选择所需的读取或写入权限。

连接后，你可以直接告诉 Agent：

> 查找 Recalloom 中我之前保存的项目进度，恢复最新的 Checkpoint 和未完成任务。完成本次工作后，更新对应记录。

Recalloom 不会自动保存每条对话；需要由客户端根据你的要求调用工具进行读取或保存。

## 本地开发

```bash
pnpm install
cp .dev.vars.example .dev.vars
# 在 .dev.vars 中填写本地测试用 MCP_AUTH_SECRET
pnpm db:local
pnpm dev
```

本地 MCP 地址为 `http://localhost:8787/mcp`。运行 `pnpm check` 和 `pnpm test` 验证更改。

如果要从本地手动部署，请先通过环境变量配置 `RECALLOOM_KV_ID` 和 `RECALLOOM_D1_ID`，再运行 `pnpm deploy`。部署脚本会执行所需的 D1 迁移。不要提交 `.dev.vars` 或本地生成的部署配置。

## 数据与安全

- Recalloom 默认面向单一所有者；获得授权的客户端可按权限访问同一个知识库。
- 修改会保留版本历史；如果记录已被其他客户端更新，旧版本上的编辑会被拒绝。
- 语义搜索索引异步更新，因此刚保存的记录可能需要稍后才能通过语义搜索找到；精确查找可使用关键词或路径。
- 备份可能包含全部历史内容和敏感数据，请安全存储。快照恢复默认先检查数据；大型数据库仍建议配合 Cloudflare D1 的备份机制。
- Web 管理 API 需要 Cap.js 验证和与 OAuth 相同的密钥登录，成功后使用可撤销的浏览器会话。**目前不提供独立的 Web 登录界面。**

## License

MIT.
