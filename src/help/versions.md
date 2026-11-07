# 版本管理、历史查询与恢复

Recalloom 使用 text-version 记录文档历史。record_contents 保存当前正文和 revision；record_histories 负责历史元数据；revisions 保存版本审计及 SHA-256 校验。**不要把版本记录数量和当前 revision 数字总是视为相等**：极少数修复过的旧记录可能只有较高版本号的单一历史基线。

## 查看历史

- version_history(id)：查看版本号、操作者、提交信息、时间和 SHA-256；按 page.nextCursor 翻页。
- read_record(id, revision)：读取指定版本权威正文；不是仅凭摘要或搜索结果推测历史。
- diff_revisions(id, fromRevision, toRevision)：查看同一条记录两个版本之间的有界 Unified Diff。
- get_outline(id, revision)：获取历史版本的大纲及源行号。

## 修改与恢复

修改正文会生成新的当前版本；不能直接覆盖或改写历史版本。恢复应使用 restore_record(id, targetRevision, expectedRevision)，它把目标历史正文作为**新的一次提交**，而不是将当前 revision 退回旧数字。

恢复结构化任务列表时，当前任务投影也一起恢复。恢复前应确认目标版本内容和最新 revision，避免覆盖其他 Agent 的并行修改。

## 版本与元数据

- 文档正文使用 revision 和 expectedRevision 做并发保护。
- 记录名称、文件夹、状态等元数据有独立 metadataRevision，不要混用。
- 只有版本审计登记和内容完整性校验都满足时，才能声称某个历史正文可用。
- 旧历史可能在修复中被舍弃；不要假设从 R1 开始的每个编号都可恢复。

## 差异与审计

存储完整性通过 SHA-256 检查。版本审计包括修改信息、操作方和时间，但搜索索引可能有异步延迟。需要知道哪些实体发生变化时，使用 changes；changes 是增量同步事件流，不能替代正文历史恢复。
