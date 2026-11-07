# 文档编辑与并发安全

Recalloom 把最新正文与 text-version 历史版本分开管理。所有正文修改必须在已授权的情况下执行，并避免覆盖并行 Agent 的工作。

## 选择编辑方式

| 需求 | 工具或模式 |
| --- | --- |
| 新建文档 | create_record（kind=document） |
| 完整替换正文 | edit_record mode=rewrite |
| 末尾追加 | edit_record mode=append |
| 单段精确替换 | edit_record mode=replace |
| 多段精确替换 | edit_record mode=replace_many |
| Unified Diff | edit_record mode=patch |
| 插入/替换/删除指定行 | edit_record mode=lines |
| 重命名、移动或归档 | manage_record |
| 任务列表条目 | mutate_task，不用 edit_record |

## 正确的读改写流程

1. 通过 resolve_path、browse 或 search 找到已有记录，不要凭名称猜 UUID。
2. 使用 read_record 获取**当前正文与 revision**；大文档可用 get_outline 和分段读取。
3. 构造最小必要修改，保留无关内容及特殊 Markdown/LaTeX 字符。
4. 如需试算，先用 edit_record 的 dryRun 验证。
5. 真实提交时提供 expectedRevision（来自刚读取的当前版本）；发生 VERSION_CONFLICT 时，重读正文、人工协调差异，不能盲目重试或覆盖。
6. 使用 MCP 的 manage_record 或 manage_folder 修改元数据时，**必须**提供读取到的 expectedMetadataRevision；注意它与正文 revision 不同。旧版本会收到 METADATA_CONFLICT，不能省略预期版本来绕过冲突。Web API 的参数约束可能与 MCP 不同。

## 精确替换与行操作

- replace 的 oldText 必须为原文精确子串；可以用 expectedReplacements 指定出现次数。
- replace_many 支持多个 oldText/newText 项，别把多步替换当作任意不受约束的正则操作。
- patch 使用 Unified Diff，依据当前正文校验。
- lines 的 start 是从 1 开始的行号，支持 insert/replace/delete 操作；读取分段内容时需核对行号和版本。
- rewrite 风险最高；只需局部编辑时优先使用更窄的修改方式。

## Markdown 注意事项

edit_record 保存的是 Markdown 源码，不是渲染后的 HTML。行内 KaTeX 使用 $...$，块公式使用独立 $$ 行；使用 <mark> 包裹公式时须遵守 math 的换行规则。Wiki 引用的 UUID 与路径应依据已确认的记录解析，详见 wiki。

结构化 task_list 的具体状态、优先级和条目管理详见 tasks。归档、删除、历史恢复等影响较大的操作需要符合用户意图。
