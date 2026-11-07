# 结构化任务列表

Recalloom 的 task_list 是独立记录类型，不是仅用 Markdown 任务复选框伪装的任务集合。

## 工具选择

- create_record(kind=task_list)：创建结构化任务列表记录。
- list_tasks：获取任务的 UUID、状态、优先级与任务列表归属，可筛选 recordId 或 status。
- mutate_task：使用 action=add/update/remove 原子性修改单个任务。
- read_record、version_history：读取任务列表正文的当前版本和历史。
- restore_record：把历史任务列表作为新版本恢复，并同步任务投影。

添加任务时，changes.title 必填；更新或删除时 taskId 必填。changes.details 可记录步骤、验收标准和进度；changes.priority 数字越大越紧急。status 允许 todo、in_progress、blocked、done、cancelled。

修改任务之前读取所属 task_list 的当前 revision，调用 mutate_task 时必须传 expectedRevision；如版本发生变化，需要重读并协调。remove 从当前任务投影移除条目，但历史版本仍可用于恢复。

## 与 Markdown 任务复选框的区别

普通 document 里写 - [ ] 或 - [x] 只是 GFM Markdown 内容，不能等同于独立任务表的状态/优先级，也不应该用 mutate_task 直接管理它。

操作任务状态时优先使用 list_tasks 与 mutate_task，不要试图手工修改 task_list 的 JSON 正文或仅根据 Markdown 摘录推断任务真实状态。
