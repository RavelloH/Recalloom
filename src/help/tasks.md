# 结构化任务列表

Recalloom 的 task_list 是独立记录类型，不是仅用 Markdown 任务复选框伪装的任务集合。

## 工具选择

- create_record(kind=task_list)：创建结构化任务列表记录。
- list_tasks：获取任务的 UUID、状态、优先级与任务列表归属，可筛选 recordId 或 status。
- mutate_task：使用 action=add/update/remove/reorder 原子性修改单个任务。
- read_record、version_history：读取任务列表正文的当前版本和历史。
- restore_record：把历史任务列表作为新版本恢复，并同步任务投影。

添加任务时，changes.title 必填；更新或删除时 taskId 必填。changes.details 可记录步骤、验收标准和进度；changes.priority 数字越大越紧急。status 允许 todo、in_progress、blocked、done、cancelled。

reorder 必须提供 taskId 和 beforeTaskId：后者是同一列表内的目标任务 UUID，传 null 表示移动到列表末尾。不能跨列表移动，也不能把任务放在自身之前。可同时提供 changes.status、title 或 details；状态和顺序会在同一次 revision 中提交。普通 add/update/remove 不接受 beforeTaskId。

尚未手动排序的列表在新界面按旧 priority 降序、原数组顺序排列。首次 reorder 将该顺序固化到任务列表 JSON 数组，并保存 taskOrder=manual；此后增加任务追加到末尾，修改优先级不会重新打乱手动顺序。旧 list_tasks 仍按更新时间分页，其排序行为不变。

Web 的 task-lists 查询包含列表名称、路径、revision、完整五状态计数和空列表；tasks/view 支持独立分页的状态列或单列表任务页。query 搜索标题和详情，并同步限制计数；有搜索词时不返回无匹配任务的空分组。状态筛选省略时包含全部五种状态，open/未完成只是 todo、in_progress、blocked 的聚合，不是新状态。folderId 范围包含后代目录，不能与 recordId 同时指定。每页默认 40 条，需跟随 nextCursor 续载，计数不受已加载页数影响。

修改任务之前读取所属 task_list 的当前 revision，调用 mutate_task 时必须传 expectedRevision；如版本发生变化，需要重读并协调。remove 从当前任务投影移除条目，但历史版本仍可用于恢复。

## 与 Markdown 任务复选框的区别

普通 document 里写 - [ ] 或 - [x] 只是 GFM Markdown 内容，不能等同于独立任务表的状态/优先级，也不应该用 mutate_task 直接管理它。

操作任务状态时优先使用 list_tasks 与 mutate_task，不要试图手工修改 task_list 的 JSON 正文或仅根据 Markdown 摘录推断任务真实状态。
