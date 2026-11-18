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
pnpm exec wrangler vectorize create recalloom --dimensions=512 --metric=cosine
```

当前版本使用 `@cf/google/embeddinggemma-2`，输出 512 维。已有 1024 维索引的实例需要先准备同名 512 维索引，再更新程序并从设置页手动重建全部有效文稿的索引。

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

- `MAIN_SECRET`：用于网页登录、批准 MCP 客户端授权及派生会话签名密钥。请使用高强度随机值，妥善保管。未设置时回退至 `MCP_AUTH_SECRET`；同时配置时以 `MAIN_SECRET` 为准。迁移变量名并保留相同的值可延续现有有效会话，更换有效密钥会使网页登录会话失效。

不要把密钥放进 GitHub 仓库、Build Variables 或公开配置文件。连接仓库后，对 `main` 分支的提交会触发构建和部署。若需要自定义域名，可在 Worker 中配置 Custom Domain，并按需将 `MCP_BASE_URL` 设为公共站点的 Origin（不包含 `/mcp`）。

## 3. 连接 MCP 客户端

部署完成后，在支持 Streamable HTTP MCP 和 OAuth 的客户端中添加：

```text
https://<你的 Worker 域名>/mcp
```

首次连接会打开 OAuth 授权页面。使用上面设置的主密钥授权客户端，并选择所需的读取或写入权限。读取权限（`notes:read`）即可连接并使用只读工具；写入类工具还需要 `notes:write`。

服务端同时支持 Client ID Metadata Document（CIMD）和动态客户端注册（DCR），OAuth 端点均保持在同一个域名下。部分客户端的 CIMD 元数据服务器会拦截 Cloudflare Worker 发出的请求；遇到“客户端元数据暂时不可用”时，可在客户端支持的情况下改用 DCR 重新连接。不要使用非官方的元数据代理，也不要关闭客户端元数据验证。

连接后，你可以直接告诉 Agent：

> 先浏览 Recalloom 中的相关目录，利用知识概览和文档大纲定位已有资料，按需阅读和总结；在我授权维护时，再更新相关文档或任务。

Recalloom 不会自动保存每条对话；需要由客户端根据你的要求调用工具进行读取或保存。

## MCP 帮助与扩展 Markdown

MCP 提供精简的英文操作速查，网页 `/help` 保留中文教程。`get_help()` 返回主题目录，`topic=markdown` 返回语法入口，配合 `component` 或 `node` 查询单项语法。只有显式选择 `topic=rmd_reference` 才返回完整 RMD 参考。

MCP Resources `recalloom://help/index` 和 `recalloom://help/{topic}` 提供同一份英文速查，无需访问 D1。

实现细节、扩展节点的安全边界、格式回退和回归测试清单见 [Rich Markdown 开发规范](rich-markdown.md)。

英文速查维护在 `src/help/mcp-topics.json`，中文文档维护在 `src/help/*.md`，两者的 RMD 参数和示例共用 `src/rmd/registry.json`。`get_help` 在结构化响应中返回 `schemaVersion`、`helpVersion` 和 `contentHash`。修改后运行 `pnpm help:generate` 更新生成文件，或使用 `pnpm help:watch`；`pnpm help:check` 校验同步状态。

网页登录会话在闲置 30 天后到期，单次登录最长保留 90 天。活跃时间及闲置到期时间每小时按需更新，Cookie 最晚在该次登录的 90 天上限到期。现有有效的旧会话在下次访问时迁移。
