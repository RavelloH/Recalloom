# 结构化任务列表

Recalloom 的 task_list 是独立记录类型。Markdown 的任务复选框只是文档正文，不会自动成为结构化任务。

## 查询和读取

- create_record(kind=task_list)：创建空任务列表；不要直接写入任务 JSON。
- query_tasks：按 recordId、folderId 子树、query 和多个 statuses 筛选。recordId 与 folderId 互斥；省略 statuses 时包含全部五种状态，空数组不选任何状态。默认 order=manual，也可用 updated 查看最近修改。跟随 page.nextCursor；游标只适用于原筛选及水位，顺序或数据变化后需重新开始查询。
- read_tasks(ids)：按最多 100 个 UUID 精确读取完整详情、所属列表名称/路径/revision 和 orderVersion；missingIds 明确列出未找到的任务。
- read_record、version_history：读取任务列表正文的当前版本与历史。该 JSON 是版本化存储内容，数组位置不代表界面顺序。

状态固定为 todo（待开始）、in_progress（进行中）、blocked（阻塞）、done（已完成）、cancelled（取消）。未完成/open 是前三者的筛选集合，不是额外状态。Web 的 task-lists 查询也包含空列表及完整计数，计数不受当前已加载页数影响。

## 唯一排序

全局看板、单个任务列表、列表模式与 MCP 共用同一个全局总序。不同记录和状态只是这个顺序的筛选子序列；没有“内层顺序”和“外层顺序”。旧 priority 字段仅为历史数据，不再决定顺序，也不属于新的任务工具参数。

place 使用 taskId 和 beforeTaskId：非空时移动到指定任务之前，锚点可以属于其他列表，但不会改变任务归属。beforeTaskId=null 表示放在 scope 的末项之后；scope 可指定 recordId、status 或两者；省略 scope 表示全局末尾，空 scope 范围也追加至全局末尾。真实插入位置按全序中的邻居计算，隐藏的其他状态任务不会被误当成不存在。不能将任务放在自身之前。

仅调整顺序不产生正文 revision。普通 status 修改保留原有位置；拖动跨列等需要一起改状态和位置时，在同一批次提交 update 与 place。新任务追加到全局末尾。

## 原子批量修改

mutate_tasks 接收 requestId、expectedRevisions、可选 expectedOrderVersion 和最多 50 个 operations。每项使用 op 判别：

- create：recordId、title，选填 details、status、clientId；返回 created 中的 clientId → UUID 映射；同一批次后续操作可用该 clientId 引用新任务。
- update：taskId、changes，允许 title、details、status；至少改变一个字段。
- delete：taskId；从当前列表移除，历史仍可读取。
- place：taskId、beforeTaskId，选填 scope；修改全局位置。
- transfer：taskId、targetRecordId；保留 UUID 和全局位置，明确改变所属列表。

先用 query_tasks/read_tasks 取得最新数据。expectedRevisions 是 `{所属列表UUID: 当前revision}`，必须覆盖所有涉及的列表（包括排序来源、锚点与 scope 的列表）；transfer 同时校验来源与目标。place 另须提供 expectedOrderVersion。每个列表在同一批次中最多生成一个内容 revision；任一校验或写入失败，整批不生效。冲突返回 applied=false、最新版本等信息，重新读取并协调后用新的 requestId 重试。

requestId 是幂等键：网络重试时必须使用完全相同的参数和 requestId，将返回第一次的结果，不会重复创建任务；不同参数不能复用同一 requestId。成功返回完整的受影响任务、deletedIds、各列表 revisions 和 orderVersion，通常无需再读取确认。

restore_record 把历史正文恢复为新版本：仍存活的任务 UUID 保留当前顺序，重新出现的 UUID 追加至末尾。整库快照 v3 则同时保存并恢复任务顺序。不要使用 edit_record 手写 task_list JSON。
