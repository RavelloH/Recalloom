# 信息流 Feed：MVP 数据结构与 Agent 协议

## 定位与边界

Feed 是 **Agent 发现 → 用户阅读和反馈 → 后续知识沉淀** 的独立动态层，不是 Knowledge 文件，也不是 Activity 修改日志。MVP 以收集可追溯的真实数据为目标；不会直接改写文档、自动创建任务、调用 LLM、生成 Embedding 或抓取外部网页。

相关实现：`migrations/0029_feed.sql`、`src/feed-model.ts`、`src/feed.ts`、`src/mcp.ts`、`src/web-api.ts`、`web/src/pages/feed.tsx`。

## 数据分层

| 数据表 | 权威含义 | 关键规则 |
| --- | --- | --- |
| `feed_items` | 信息流中一条合并后的动态 | `id` UUID，`dedupe_key` 唯一；`revision` 用于增量未读 |
| `feed_observations` | 某 Agent 某次投稿的不可变证据 | `UNIQUE(actor,submission_key)`，始终保留 Agent 身份和原始来源 |
| `feed_relations` | Feed 与现有 Knowledge/Tasks/Tags/Collections 的轻关联 | 引用稳定 ID；投稿时检查目标存在；不会修改关联对象 |
| `feed_states` | 所有者的阅读、收藏、忽略、稍后和明确评价 | `read_revision` 与 Item 修订号比较；单用户 `viewer_id='owner'` |
| `feed_feedback_events` | 追加式反馈事件 | 单独记录动作、目标版本和时间，方便离线准确率评测 |

注意区分 `kind`（发布/研究/提醒/摘要等动态类型）和 `sourceKind`（GitHub/RSS/网页/论文/内部分析等来源类别）。

**证据不等于事实**：`evidenceExcerpt` 是 Agent 提供的来源片段，`whyRelevant` 是 Agent 对当前用户工作的解释。UI 必须明确呈现来源，不得将分析推测伪装成已证实新闻。

## MCP 投稿约定

- `publish_feed`：提交一条 **已经初筛、确有关注价值** 的动态。要求 `submissionKey`、`kind`、`title`、`summary`、`sourceKind`，并至少给出 `sourceUrl` 或 `eventKey`。
- 同一 Agent 重试时，必须使用 **相同 submissionKey 与完全相同的规范化内容**；不同负载重用键会返回 `FEED_IDEMPOTENCY_CONFLICT`。
- 提供 HTTP(S) `sourceUrl` 时，系统会删除 fragment、常见营销跟踪参数并排序其余查询参数。规范化后的同一 URL 会在不同 Agent 间合并到一个 Item；每个 Agent 的 Observation 仍单独保存。
- 没有 URL 的内部研究可以使用 `eventKey`；这种键按 Agent 身份隔离，避免不同 Agent 将无关内部发现误合并。
- `whyRelevant` 应具体说明与现有研究/项目/待办的关系；`publishedAt` 使用有时区的 ISO 8601 时间；`relations` 可填至多 8 条记录、任务、标签或集合的稳定 ID。
- 每个 Agent 最多提交 **200 条新 Observation / 滚动 24 小时**；服务端采用 OAuth actor，不相信正文里的自称身份。
- 若来源实质是同一事件但 URL 不同，MVP **不会自动语义合并**；后续可通过去重评测验证是否值得升级。

示例投稿参数（测试占位，不代表真实新闻）：

```json
{
  "submissionKey": "example-project-release-2026-11",
  "kind": "release",
  "title": "示例项目发布新版",
  "summary": "更新了检索索引相关功能。",
  "whyRelevant": "与 Recalloom 当前的索引重构研究相关。",
  "sourceKind": "github",
  "sourceUrl": "https://github.com/example/project/releases/tag/v1",
  "publisher": "Example Project",
  "evidenceExcerpt": "Release notes: improved incremental indexing.",
  "relations": []
}
```

## Web 阅读

路由 `/feed`：时间倒序、关键词和类型筛选、未读、收藏、稍后、忽略；详情面板展示全部 Agent 来源和关联对象。

- 打开详情会标记当前 Revision 为已读；新增 Observation 使 Revision +1，原 Item 重新进入未读集合。
- 收藏、忽略、稍后、明确“有帮助/不相关”反馈都可撤销或修改，动作同步写入 `feed_feedback_events`。
- `GET /api/feed`、`GET /api/feed/:id`、`POST /api/feed/:id/state` 都继承现有 Web 会话鉴权与跨站写入保护。
- MCP `query_feed` 和 `get_feed_item` 允许授权 Agent 查询；用户反馈状态仅经 Web 登录会话修改，**不向 Agent 开放反馈修改工具**，避免混入非用户来源的训练标签。

## 生命周期与数据质量

目前普通动态默认 60 天、Insight 90 天、Alert 14 天过期（可由投稿提供 `expiresAt`）。过期的普通动态从收件箱隐藏；**不自动物理删除**，以保留第一批真实数据及反馈，未来再设计保留策略。

`feed_items` 不加入现有文档 Embedding/Vectorize，也不进入 Wiki、Knowledge 目录和文档活动日志。图片不抓取、不托管；Web 第一版采用文字主导的低密度卡片，避免低质量封面和额外存储成本。

当前 `recalloom-snapshot-v5` **不包含 Feed 数据**。上线前及日常灾备应依赖 D1 数据库级备份；后续应设计独立的 Feed 分页备份导出，而非把全部短期动态塞入文档快照。

## 真实数据评估指标（后续）

首批 2–4 周重点观察：每 Agent 投稿数、精确去重率、每条动态的 Observation 数、阅读比例、收藏比例、明确 helpful/irrelevant 反馈及其按来源/类型的分布、阅读到反馈耗时和忽略率。

不要把“未阅读”直接当作负样本，也不要把“忽略”直接当作不相关；只有用户明确给出的反馈才应成为相对可信的监督信号。评测前做来源分层和时间抽样，避免热门高频 Agent 主导指标。

## 下一阶段（不属于 MVP）

跨 URL 的谨慎语义去重、动态排序、来源可信度评估、按主题订阅、收藏内容转 Knowledge/Task、图片代理、过期物理清理、完整 Feed 快照、反馈看板。应先分析真实数据，再确定阈值和模型调用预算。
