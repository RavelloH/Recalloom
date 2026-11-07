# 快照导出、校验与恢复

Recalloom 使用 recalloom-snapshot-v2 格式，支持文档、元数据、版本历史与相关结构的分页导出及原子性恢复。快照可能包含敏感的历史正文，应按敏感数据妥善存放。

## 导出

1. 调用 export_snapshot，不传 cursor；可设置 limit 控制每页返回的记录数（最多 5）。
2. 读取返回的 page.nextCursor，依次获取后续页面，直到为空。
3. 保持原始顺序与内容，收集所有页面为 {pages:[...all pages...]}。
4. 记录并核对水位及 SHA-256；如导出过程中数据变化导致快照失效，应重新导出，不能把不同状态的页面拼接成合法备份。

## 验证和导入

import_snapshot 接收**完整** bundle={pages:[...]}，而不是其中某一页。默认 dryRun=true，只进行格式、哈希、冲突及规模校验，不修改当前数据。

只有在用户明确授权真实导入、并已充分检查覆盖/冲突风险后，才将 dryRun=false；服务端会以原子性方式导入，并保护已有 UUID 和路径，且有限制条件。切勿假设可以无条件覆盖整个知识库。

## 与常规版本恢复的区别

- 恢复单条记录的旧版本：使用 restore_record，并提供 expectedRevision。
- 检查历史正文差异：使用 version_history、read_record(revision)、diff_revisions。
- 跨实例/整库快照迁移：使用 export_snapshot/import_snapshot。

快照导入并不是一项自动后台任务，也不是编辑 Markdown 的替代操作。涉及风险的真实写入应先 dryRun 和人工确认。
