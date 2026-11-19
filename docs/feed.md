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
| `feed_states` | 所有者的阅读修订与互斥兴趣偏好 | `read_revision` 与 Item 修订号比较；单用户 `viewer_id='owner'` |
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

## Web 阅读与兴趣状态（2026-11-19 修订）

列表按发布时间倒序；没有发布时间时按首次收录时间排序。日历分组与服务端使用相同的时间基准，复合排序游标保证同一时刻的记录也能稳定分页。

详情不再使用独立的 ContextPanel / Drawer，改成项目共用的 WorkspacePanel，并与任务页面保持一致：每条 Feed 都有独立且可重新激活的面板，桌面允许多个面板堆叠、折叠与拖拽；reserveSpace=false，不因打开面板而挤窄主信息流。面板内容遵循任务详情的统一内边距（桌面左右 18px，移动端左右 20px），窄屏仍使用既有 BottomSheet。

视图为：动态（默认总览）、未读、已读、收藏、感兴趣、不感兴趣。后五个构成互斥状态机：

| 状态 | 存储判定 | 推荐含义 |
| --- | --- | --- |
| 未读 | 无显式偏好且已读修订小于当前修订 | 尚未充分阅读 |
| 已读 | 无显式偏好且当前修订已读 | 阅读过，但没有明显兴趣 |
| 收藏 | preference=saved | 最高等级的明确兴趣 |
| 感兴趣 | preference=interested | 正向兴趣 |
| 不感兴趣 | preference=not_interested | 明确负向兴趣，不进入普通动态 |

卡片固定四个操作：收藏、有兴趣、没兴趣、阅读详情。三种显式偏好互斥；重复点击已选项则撤销并返回已读。三种偏好操作同时把当前修订标记为已读。删除了原先的「稍后」「忽略」「有帮助」「不相关」操作。

自动已读：页面在前台并具有焦点，卡片可见面积达到卡片高度 65% 或视口高度 60%（两者取较小值），并稳定持续 1.4 秒，才标记当前修订为已读；短暂滑过和后台页面不计。打开详情也算已读。「未读」视图会保留本次浏览中自然转已读的卡片，直到离开视图；主动选择偏好则从未读视图平滑移出。卡片退出和重排采用支持减少动画偏好的布局过渡。

### Agent 反馈查询

新增只读 MCP 工具 query_feed_feedback：按 preference_updated_at 降序查询明确兴趣反馈。支持 sentiment=positive（收藏+感兴趣）、negative（不感兴趣）、单一 preference、kind、since 和游标分页，返回可直接用于下次推荐的标题、摘要、来源与显式偏好。自动已读不应作为喜欢或不喜欢的训练标签。Agent 仍不能修改用户反馈。

迁移 0030_feed_preferences.sql 为旧数据回填新的互斥偏好：收藏优先，其次旧的不相关/忽略，再次旧的有帮助；原有历史数据及反馈事件保留。

### 内容类型的未来扩充

当前五种 kind（资讯、版本发布、Agent 发现、重要提醒、精选摘要）与用户兴趣状态无关。建议下一步在有真实投稿样本后增加「研究成果」「项目里程碑」「活动/时间节点」三种，先检查与现有类型的边界，再以单独数据库迁移扩展类型约束，避免过早细分导致 Agent 分类不一致。

## 生命周期与数据质量

目前普通动态默认 60 天、Insight 90 天、Alert 14 天过期（可由投稿提供 `expiresAt`）。过期的普通动态从收件箱隐藏；**不自动物理删除**，以保留第一批真实数据及反馈，未来再设计保留策略。

`feed_items` 不加入现有文档 Embedding/Vectorize，也不进入 Wiki、Knowledge 目录和文档活动日志。图片不抓取、不托管；Web 第一版采用文字主导的低密度卡片，避免低质量封面和额外存储成本。

当前 `recalloom-snapshot-v5` **不包含 Feed 数据**。上线前及日常灾备应依赖 D1 数据库级备份；后续应设计独立的 Feed 分页备份导出，而非把全部短期动态塞入文档快照。

## 真实数据评估指标（后续）

首批 2–4 周重点观察：每 Agent 投稿数、精确去重率、每条动态的 Observation 数、阅读比例、收藏/感兴趣/不感兴趣的比例与按来源/类型分布，以及浏览到显式反馈的耗时。

不要把“未阅读”或“仅已读”直接当作负样本；只有明确给出的反馈才应成为相对可信的监督信号。评测前做来源分层和时间抽样，避免热门高频 Agent 主导指标。

## 下一阶段（不属于 MVP）

跨 URL 的谨慎语义去重、动态排序、来源可信度评估、按主题订阅、收藏内容转 Knowledge/Task、图片代理、过期物理清理、完整 Feed 快照、反馈看板。应先分析真实数据，再确定阈值和模型调用预算。
