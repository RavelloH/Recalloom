# 部署到 Cloudflare

需要 Cloudflare 账户，以及 **Workers、D1、KV、Vectorize 和 Workers AI**。本地构建需要 Node.js 24 与 pnpm 11。

## 1. 创建资源

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

## 2. 配置自动部署

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

## 3. 连接 MCP 客户端

部署完成后，在支持 Streamable HTTP MCP 和 OAuth 的客户端中添加：

```text
https://<你的 Worker 域名>/mcp
```

首次连接会打开 OAuth 授权页面。使用上面设置的 `MCP_AUTH_SECRET` 授权客户端，并选择所需的读取或写入权限。读取权限（`notes:read`）即可连接并使用只读工具；写入类工具还需要 `notes:write`。

服务端同时支持 Client ID Metadata Document（CIMD）和动态客户端注册（DCR），OAuth 端点均保持在同一个域名下。部分客户端的 CIMD 元数据服务器会拦截 Cloudflare Worker 发出的请求；遇到“客户端元数据暂时不可用”时，可在客户端支持的情况下改用 DCR 重新连接。不要使用非官方的元数据代理，也不要关闭客户端元数据验证。

连接后，你可以直接告诉 Agent：

> 先浏览 Recalloom 中的相关目录，利用知识概览和文档大纲定位已有资料，按需阅读和总结；在我授权维护时，再更新相关文档或任务。

Recalloom 不会自动保存每条对话；需要由客户端根据你的要求调用工具进行读取或保存。

## MCP 帮助与扩展 Markdown

MCP 服务提供简短的全局使用说明、每个工具的操作描述，以及按需读取的完整帮助。只读工具 `get_help` 在省略 `topic` 时列出主题；可使用 `get_help({"topic":"markdown"})`、`get_help({"topic":"math"})` 和 `get_help({"topic":"wiki"})` 阅读语法、注意事项和示例。帮助覆盖 CommonMark/GFM、KaTeX 行内与块级公式、RMD 1.0 Mark 与九色 Highlight（支持行内/块公式）、WikiLink、内容嵌入、编辑、版本、检索、任务、归档生命周期及备份。通过 `get_help({"topic":"lifecycle"})` 可查看安全归档、永久删除及递归目录删除的完整规则。

支持 MCP Resources 的客户端还可读取 `recalloom://help/index` 或 `recalloom://help/{topic}`；Resources 与 `get_help` 使用相同的本地 Markdown 文档，不依赖 D1，也不会为使用帮助而修改知识库。

实现细节、扩展节点的安全边界、格式回退和回归测试清单见 [Rich Markdown 开发规范](rich-markdown.md)。

帮助正文的唯一来源是 `src/help/*.md` 与 `src/help/manifest.json`。`get_help` 会返回 `schemaVersion`、根据文档内容生成的 `helpVersion` 和完整 SHA-256 `contentHash`；帮助索引 Resource 也展示这些标识，以便识别过期的帮助。修改文档后运行 `pnpm help:generate` 更新编译模块，或在开发时使用 `pnpm help:watch` 自动更新。`pnpm help:check` 检查生成结果是否同步，`pnpm check`、`pnpm test` 与 `pnpm deploy` 均会执行此检查。新增 Markdown 扩展时应同时更新相应帮助文档与语法回归测试。
