# Recalloom

**让人类与 AI Agent 协同组织、检索与维护长期知识。**

Recalloom 是一个可自部署的版本化个人知识库，同时提供 Web 控制台和 MCP 接口，供人类与 AI Agent 共享和维护知识。文档、阶段总结、研究笔记与结构化任务均存储在自己的 Cloudflare 账户中，支持跨会话查找和持续协作。

## 功能

- **知识导航**：通过目录概览、Markdown 大纲、路径及检索定位资料；跨会话恢复只是其中一种使用方式。
- **通用内容与任务**：Markdown 文档可附加标签（如 `checkpoint` 表示阶段快照）；结构化 TODO 保留独立的状态与优先级。
- **多种检索方式**：支持关键词、语义和混合搜索，以及标签、关联记录和指定目录范围内的查找。
- **版本历史**：保留记录修改历史，支持差异查看、冲突保护和恢复旧版本。
- **协作与审计**：追踪 Agent 的修改，避免不同客户端无意覆盖彼此的工作。
- **备份与恢复**：提供知识库快照导出和恢复前检查，便于迁移与备份。
- **安全连接**：使用 OAuth 授权 MCP 客户端，可分别授予读取与写入权限。

**Web 管理控制台**：可通过浏览器登录、浏览目录、编辑 Markdown 与结构化任务、查看版本历史和活动、搜索知识库及管理会话。提供亮色/暗色模式、移动端布局，以及 Tiptap 可视化编辑与 Markdown 源码编辑。与 MCP 客户端共享相同的内容和版本历史。前端以 Astryx Neutral 为设计系统，基础控件优先使用 Astryx；Markdown 编辑器与知识库业务视图按需组合实现。

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

> 先浏览 Recalloom 中的相关目录，利用知识概览和文档大纲定位已有资料，按需阅读和总结；在我授权维护时，再更新相关文档或任务。

Recalloom 不会自动保存每条对话；需要由客户端根据你的要求调用工具进行读取或保存。

## 本地开发

```bash
pnpm install
cp .dev.vars.example .dev.vars
# 在 .dev.vars 中填写本地测试用 MCP_AUTH_SECRET
pnpm db:local
pnpm dev
```

本地 MCP 地址为 `http://localhost:8787/mcp`。如需开发网页，在另一个终端运行 `pnpm dev:web`，打开 `http://localhost:5173`；它会将 API 请求代理到本地 Worker。运行 `pnpm check`、`pnpm test` 和 `pnpm build:web` 验证更改。

如果要从本地手动部署，请先通过环境变量配置 `RECALLOOM_KV_ID` 和 `RECALLOOM_D1_ID`，再运行 `pnpm deploy`。部署脚本会执行所需的 D1 迁移。不要提交 `.dev.vars` 或本地生成的部署配置。

## 数据与安全

- Recalloom 默认面向单一所有者；获得授权的客户端可按权限访问同一个知识库。
- 修改会保留版本历史；如果记录已被其他客户端更新，旧版本上的编辑会被拒绝。
- 语义搜索索引异步更新，因此刚保存的记录可能需要稍后才能通过语义搜索找到；精确查找可使用关键词或路径。
- 备份可能包含全部历史内容和敏感数据，请安全存储。快照恢复默认先检查数据；大型数据库仍建议配合 Cloudflare D1 的备份机制。
- Web 控制台入口为 `https://<你的 Worker 域名>/login`，使用与 MCP OAuth 授权相同的 `MCP_AUTH_SECRET` 登录。先完成 Cap.js 验证，成功后使用可撤销的浏览器会话，后续操作无需重复输入密钥。

## License

MIT.
