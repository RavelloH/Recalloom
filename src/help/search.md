# 搜索、向量索引与知识关系

Recalloom 具有元数据、字面文本、语义向量和混合检索，以及手动关系、自动 Wiki 引用、反向链接和有界知识图谱。不同来源的结果可信度与时效不同。

## 检索选择

| 需求 | 推荐模式 |
| --- | --- |
| 已知完整路径 | resolve_path |
| 精确名称/描述 | search mode=metadata |
| 刚写入的关键词或源码片段 | search mode=literal |
| 按语义寻找相关资料 | search mode=semantic |
| 综合检索 | search mode=hybrid 或 auto |
| 浏览某目录及近期内容 | browse、get_overview |
| 读取最终权威正文 | read_record、read_many |

semantic 使用 Vectorize，异步分块索引可能滞后；不可把“未检索到”视作“内容不存在”。minScore 是**原始语义相似度阈值**，默认 0.43，不适用于字面分数。搜索结果只是候选，需要继续读取正文验证。

## 关系的不同类型

- 手动显式关系：由 manage_link 创建、移除，list_links 可读取。
- Wiki 自动引用：来自 Markdown [[id:UUID]]、[[/路径.md]] 与 RMD 1.0 的 ::: embed 目标 :::，不会由 manage_link 自动等价创建；其目标身份与索引见 wiki 帮助。
- 语义候选：Vectorize 根据文本相似度推荐，**不是已确认关系，不会自动保存为手动链接**。
- 同目录关系：关系图可展示同目录近邻，不能当作内容相互引用的证据。

related_records 返回已确认的入站/出站关系及可选语义候选，注意 semanticStatus。get_knowledge_graph 提供**有界图谱**：focusId 限定中心及近邻，省略时返回近期子图（最多 100 个节点），不是全库完整遍历。

## 索引操作

新增或更新正文后会异步入队索引任务。使用 index_diagnostics 观察排队、失败与过期任务；index_pending 可以立即处理有限批任务，会修改向量索引，不会编辑正文。通常交给 Cron 自动处理即可。

## 读取与分页

列表类结果使用 items、page；如需完整结果根据 page.nextCursor 继续。get_outline 和 read_many 可减少长文档一次性载入的开销。不要用图谱节点摘要或搜索摘录替代权威正文。
