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

## Web 编辑器的两种模式

- **可视化（默认）**：统一阅读、编辑已支持的 Markdown；未知语法显示为普通可编辑文本，编辑其余内容时保留未知片段原文。
- **源码**：直接修改 Markdown 全文，适合不被可视化解析的语法与精确格式修改。
- 两种模式操作同一份 Markdown 正文，不再有独立的文档预览模式；只读嵌入不等于第三种编辑模式。
- 仅切换模式、查看文档不应自动保存。用户真正编辑可视化内容后，支持的语法允许合理规范化，而不能丢失未知语法和未触及的内容。

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

结构化 task_list 的具体状态、优先级和条目管理详见 tasks。归档会从活动路径移除记录，删除文件夹将归档其所有后代，永久删除只允许已归档记录；详细安全和并发规则参见 lifecycle。

## Rich Markdown 的编辑与保存

Banner、Collapsible、Badge、显式缩略词和提示、始终可见的注释、彩色高亮和增强代码块的具体语法见 markdown 帮助主题。缩略词/提示在可视化编辑器内使用无 DOM 副作用的 CSS 主题化提示层，Wiki 嵌入则可复用 Astryx Tooltip。**严禁在 Tiptap NodeViewContent 内挂载动态 Tooltip 触发器**：此行为会使包含 :abbr 或 :tip 的文档首次打开就错误进入“未保存”状态；提示展示绝不能触发内容编辑。**打开文档、等待 Shiki 高亮、异步获取链接图标都不得触发未保存状态。** 外链图标是运行时表现，不应写入内容版本。浏览器直接向 Meta API 发送完整网站链接，完整路径会被解析服务看到，但查询参数与锚点会预先移除；原站 HTTP/HTTPS 图片则通过有会话鉴权的同源图片代理 `/api/link-image` 下载。此代理不能公开、不能被滥用为访问内网的通用代理，也不得返回可执行的同源 SVG/HTML。

文档元信息不由 Markdown Front Matter 提供。Recalloom 的标题、标签、路径、状态等独立记录属性只通过数据库/API 修改。已有 `---`/`+++` 风格的文档头部只作为普通可编辑文本保留，不能识别为属性卡片、解析 YAML 标签或覆盖数据库元信息；不要建议 Agent 在文档中添加 YAML 元数据头。

Astryx Tabs 在可视化编辑模式直接切换当前可见面板，未选中面板只是 CSS 隐藏而非卸载；点击标签不能触发文档编辑或丢失未选中的内容。标题 {#id} 和段落末尾 ^block-id 在可视化中变成稳定 DOM 锚点，源码导出时重新附上原标记。相同 ID 需人工避免重复；列表/表格/数学块锚点暂未实现。

CriticMarkup 五种审阅标记 `{++新增++}`、`{--删除--}`、`{~~旧~>新~~}`、`{==重点==}`、`{>>批注<<}` 都只表达建议；可视化中显示弱化但不隐藏的批注和建议，编辑/保存仍以原 Markdown 为权威。Agent 不应仅凭 CriticMarkup 擅自接受删除或改写正文；接受/拒绝审批工具目前不存在。
长文档的站点图标使用外部 CSSOM 样式，不可直接修改 ProseMirror 管理的链接 DOM，避免编辑器无限布局和内存泄漏。

深浅主题切换不能改变文档内容或触发保存。代码区使用跟随 data-effective-theme 的 Shiki high-contrast 双主题，Mermaid 重新渲染为安全独立图像，图标必须经鉴权图片代理并在中性边框底板上显示；任何这些表现层变化都不得通过直接修改 ProseMirror 内的 DOM 属性实现。

学习闪卡 `::::flashcard` 包含 `:::front`（问题）和 `:::back`（答案）。**可视化编辑器默认显示问题、折叠答案；点击 Astryx“显示答案”即可展开并直接编辑，之后可收起。** Cloze `:cloze[答案]{hint="提示"}` 也在可视化编辑器中点击揭示并直接编辑答案，文本节点始终挂载；Tabs 在可视化编辑器中切换真正可见的面板。展开、收起、切换不是文档修订，不能自动调用 edit_record 或解释为授权删除。Kbd `:kbd[...]` 只展示而不执行。Wiki 的只读嵌入只是投影，不是 Recalloom 的第三种模式。复习调度、评分与统计仍未实现。

图片尺寸与图注属于 **内容呈现**，不是记录元数据。独立图片可在 Markdown 后写 `{width=480 caption="说明"}`，点击图片在可视化编辑器内直接修改，普通图片不受影响，未知属性保留为普通文本。`::::glossary` 与 `:::definition[术语]` 使用显式容器边界；术语名和定义正文可以直接编辑，不能把它们当成标题、标签、路径等独立文件属性。图注、图片尺寸及词条编辑才产生内容修订，纯渲染和预览不能导致未保存状态。
