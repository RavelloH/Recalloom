# 文件生命周期、归档与永久删除

Recalloom 将活动目录与归档资料分开管理。常规记录不能直接永久删除：先使用 manage_record 归档，之后才能使用 delete_archived_record。删除文件夹只归档记录，不会永久清除其正文。

## 生命周期

| 场景 | 工具 | 效果 |
| --- | --- | --- |
| 新建 | create_record | 创建活动记录并占用活动目录路径 |
| 归档记录 | manage_record(status=archived,expectedMetadataRevision) | 移出活动文件夹；保留 UUID、正文、版本、任务和引用 |
| 枚举归档 | list_archived(limit,cursor,query) | 专用归档入口，按名称或原路径筛选 |
| 读取归档 | read_record(id) | 已知 UUID 时仍可读取正文、版本和历史 |
| 恢复 | manage_record(status=active,expectedMetadataRevision) | 默认恢复到原文件夹，冲突或原目录消失时要求指定 folderId/name |
| 永久删除 | delete_archived_record(id,expectedMetadataRevision,expectedRevision,dryRun) | **仅归档记录**；删除正文与所有历史，不提供撤销 |
| 删除目录 | delete_folder(id,expectedMetadataRevision,dryRun,previewToken) | 递归归档仍在目录内的记录，然后移除整个目录树 |

**归档后不是只读状态**：已知 UUID 的调用者仍可读取或编辑；它不再进入 browse、resolve_path、search、get_overview、任务汇总、默认图谱，也不再占用活动文件名。任何希望发现归档的客户端都应使用专用 list_archived。

## 原路径与恢复

归档记录的 folderId 设为 null，同时保存 `archivedFromPath`、`archivedFromFolderId` 和 `archivedAt`。返回的 `path` 对归档记录是历史位置，不代表仍可使用 resolve_path 解析；持久引用始终应使用 UUID。

恢复时默认尝试原文件夹。若文件夹已删除，服务端返回 RESTORE_DESTINATION_REQUIRED；传入 folderId=null 可显式指定根目录。若同名活动记录/文件夹已占用目标路径，返回 PATH_CONFLICT：先重命名归档记录或选择其它文件夹，绝不覆盖现有记录。恢复不会重建已删除的目录树。归档和恢复只增加 metadataRevision，不增加正文 revision。

## 永久删除归档记录

1. 使用 list_archived 寻找归档记录，read_record(metadataOnly=true) 获取两个最新版本号。
2. 先调用 delete_archived_record，默认 dryRun=true；检查将永久删除的正文历史、任务、手动关联、Wiki 引用影响和向量索引数量。
3. **仅当用户明确授权永久删除**，才以相同 UUID 和 expectedMetadataRevision、expectedRevision 调用 dryRun=false。
4. 服务端再次核对记录仍然归档、版本未改变，并在原子事务中删除数据和记录删除审计事件。Wiki 引用会失去目标，已固定的路径引用不会重绑定到新同名记录。外部 Vectorize 向量的删除排入可重试的持久队列，由 Cron 或 index_pending 处理，index_diagnostics 可观察清理队列。

永久删除不能通过 restore_record 恢复；删除前独立导出的历史快照、外部备份仍可能持有副本。如需同时清除备份，应另行处理备份保留策略。

## 删除文件夹

- 对空文件夹执行 delete_folder，删除该目录本身。
- 对非空文件夹执行 delete_folder：找出所有子文件夹和活动记录，**记录转归档，目录树删除**。目录下原先已归档的记录不被永久删除。
- 必须先以 dryRun=true 获取影响数量和 previewToken。确认后，再带上相同的 expectedMetadataRevision、previewToken 并设置 dryRun=false。
- 执行时还会核对所有受影响记录的内容与元数据版本、目录结构以及成员数量；若中途有其他 Agent 改动，返回 STALE_DELETE_PREVIEW、METADATA_CONFLICT 或数据库约束错误。重新预览，而不是盲目重试。
- 单次原子操作最多处理 100 个文件夹、500 条记录；超限会拒绝操作且不修改数据。大型目录需要先拆分处理。

文件夹删除不会删除任何记录版本或修改正文；只是改变状态及归档来源信息。删除后，归档可通过 list_archived 查看，恢复时需要选择仍存在的目录。此操作与 delete_archived_record 不同。

## 对搜索、索引、关联及备份的影响

归档立即从字面、语义搜索结果中排除，并排队清理索引；图谱中的确认引用保留，语义建议被排除。归档记录仍进入完整 export_snapshot 快照。永久删除后，D1 中的记录、历史、任务及手动关联被移除，外部向量异步清理；目标 Wiki 引用不会自动转向别的文件。涉及敏感信息和不可逆操作时务必取得明确授权。
