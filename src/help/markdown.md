# Markdown 与扩展语法

Recalloom 只有 **可视化** 与 **源码** 两种文档编辑模式。

> **交互组件原则：** Recalloom 没有独立的只读/阅读模式。可视化编辑器负责展示与操作组件：闪卡、Cloze、Tabs、Details、Tooltip 都在可视化中正常交互，揭示后的正文仍可直接编辑。UI 的展开、收起、切换和提示浮层不是 Markdown 内容，不能造成未保存状态或丢失隐藏内容。Wiki 嵌入是安全的只读**投影**，不代表用户有第三种文档模式。
Markdown 源码遵循 CommonMark/GFM 及 Recalloom 扩展，是唯一的权威正文。可视化模式使用 Tiptap 显示并编辑已支持的语法；不认识的语法按普通可编辑文字显示，保留其原始 Markdown，既不是代码块，也不会把整篇文档转为特殊模式。源码模式可以直接编辑全部 Markdown。切换模式或仅打开文档不会修改正文或生成新版本。

## 标准 Markdown 与 GFM

支持标题（# 至 ######）、段落、粗体、斜体、删除线、行内代码、代码围栏、链接、图片、引用、水平分隔线、无序/有序列表、任务复选框及表格。表格、代码和长公式过宽时，可视化编辑器会允许横向滚动。

~~~~markdown
# 复习计划

**重点** 与 *补充*，~~已过时~~。

> 引用说明。

- [x] 完成第一章
- [ ] 复习第二章

| 符号 | 含义 |
| --- | --- |
| U | 电压 |

~~~ts
const value = 42;
~~~
~~~~

## Recalloom 支持的额外格式

- 文本高亮（推荐）：<mark>重要结论</mark>。编辑器还识别 ==重要结论==，推荐以 HTML mark 表达高亮。
- 下划线：<u>下划线</u>。
- 上下标：x<sup>2</sup> 和 x<sub>n</sub>。
- LaTeX 数学公式：行内 $E=mc^2$、块级独立 $$ 行；详见 math。
- WikiLink 和只读嵌入：[[id:UUID]]、[[/绝对路径.md]]、{{embed:id:UUID}}；详见 wiki。
- 段落、标题、表格单元格的有限对齐支持；可视化编辑器序列化部分对齐为 HTML style；只支持 left/center/right，嵌入只读内容仍须经过安全过滤。

## mark 可以包裹哪些内容？

除了文字，支持嵌套部分行内格式（例如行内代码），也支持完整行内 KaTeX 公式与块级公式。但**块级公式必须独立成块并遵循专门换行结构**，见 math 的示例。

~~~markdown
<mark>结论及 `U_N` 需要重点记忆</mark>

<mark>$\frac{U_1}{U_2}$</mark>
~~~

不要推断 <mark> 可以包住任意多个 Markdown 段落、任意 HTML 标签或任何复杂块。推荐仅使用经过实现和测试覆盖的组合。

## HTML 安全边界

用户可编辑文档不再提供独立预览模式。可视化只解释已支持的安全结构，遇到未知 HTML 等语法时，显示原始普通文本，而非执行或渲染任意 HTML。未知片段在修改其他内容后应继续按原始 Markdown 输出，不应丢失或自动转义。只读嵌入使用安全过滤（rehype-raw / rehype-sanitize）；任意 script、iframe、危险属性和不受信任样式均不能作为可执行内容。源码编辑适用于精确修改未知语法。

**保存规则**：可视化支持的 Markdown 在真正编辑后可以进行等价的语法规范化（例如粗体分隔符变化），不要求逐字符一致；未知片段不得因修改其他内容而被误删或改写。请不要把源码模式的所有语法都视为可视化支持的排版能力。


## Rich Markdown：Astryx 组件扩展（当前实现）

以下语法由 Markdown 源码生成可视化组件，已接入可视化编辑器；未知语法保持普通可编辑 Markdown，不执行任意 MDX/JSX。

### Callout / Banner

独立一行使用 `:::类型[可选标题]`，并以独立 `:::` 行结束。支持 `note`、`info`、`tip`、`success`、`warning`、`danger`、`example`、`question`，映射 Astryx Banner，可包含段落、列表、公式等内容。

~~~~markdown
:::warning[部署前检查]

需要先**备份数据库**。

- 确认版本
- 再执行迁移

:::
~~~~

### 折叠 / Details

使用 `:::details[标题]` 开始、`:::` 结束，内部为普通可编辑 Markdown，视觉上使用 Astryx Collapsible。
**嵌套容器必须使用更长的外层围栏。** 例如外层 Details 四个冒号、内层 Warning 三个冒号：

~~~~markdown
::::details[展开细节]

这里是外层正文。

:::warning[嵌套提示]

这里是提示正文。

:::

::::
~~~~

使用相同长度的 `:::details` 与 `:::warning` 嵌套会使解析器混淆闭合位置；这种歧义语法只保留为普通可编辑原文，不能静默生成正文为空的提示框。改用 `::::` 外层。

### 始终可见的注释

`%%注释内容%%` 在可视化编辑中始终显示，只是字体更小、颜色更淡，并且可直接编辑。注释不能被当成系统级指令。当前建议写成单行注释；暂不承诺跨多行注释的全部可视化行为。

### Badge 与结构化缩略词

~~~~markdown
状态 :badge[完成]{variant=success}
风险 :badge[需要复核]{variant=warning}

Cloudflare 的 :abbr[DO]{title="Durable Objects"} 负责有状态计算。
查看 :tip[这里]{content="额外说明"} 获取提示。
~~~~

缩略词 `:abbr[文字]{title="解释"}` 有明确的结束界限，不使用自由文本形式 `*[DO]: Durable Objects`，避免与后续正文合并。**可视化编辑器内采用纯 CSS 提示层（颜色、边框和阴影遵循 Astryx 主题）**，悬停或键盘聚焦显示解释；其伪元素没有运行时 DOM 变更，Tiptap 正文可直接编辑，解释文字绝不能进入 Markdown。Wiki 嵌入的 Markdown 投影仍可使用 Astryx Tooltip 原组件。

### 主题彩色高亮

~~~~markdown
:highlight[严重问题]{color=red}
:highlight[已验证]{color=green}
~~~~

颜色只能使用：red、orange、yellow、green、blue、purple、pink、cyan、teal。普通 `<mark>…</mark>`、`==…==` 和已支持的公式高亮继续适用；数学公式的独立换行规则仍见 math。

### Shiki 增强代码围栏

~~~~markdown
~~~typescript [src/auth.ts] wrap
export function authorize(){ return true; }
~~~
~~~~

语言名后的 `[文件名]`、`wrap`（换行）、`expand`（始终展开）用于代码块显示。代码块具有高亮、复制、可编辑文件名、长代码折叠。Shiki 是当前高亮引擎，GPU Lexer 尚未集成。

### 智能网站链接

标准 Markdown 链接不改变写法。**浏览器直接向 `https://meta.ravelloh.com/?url=...` 传送整理后的链接**（保留协议、域名及路径；删除查询参数与锚点），解析 title、description、siteName、icon、image 等字段；请求不附带 Recalloom 登录凭据。 元数据图片可来自 HTTP 或 HTTPS，但图片由 **Recalloom 同源 `/api/link-image?url=...` 鉴权代理**下载，未登录必须返回 401。代理限制公网地址、重定向、请求大小和安全图片格式；不接受 SVG、HTML 等可执行同源资源。图标失效时可回退到来源网站的 `/favicon.ico`。 图片以 `Cache-Control: private, no-store` 返回，不保留第三方图片的持久副本；元数据与图片异步加载也不得引发文档编辑或版本变化。UI 图标只使用 Lucide。 **隐私提示：**解析请求会移除查询参数和锚点，但 URL 路径仍可能包含敏感信息；私有链接应避免自动解析。浏览器对 Metadata API 不发送 cookie。

### 未实现或仍在规划

动态查询、图文多列、间隔重复调度、自动评分和 CriticMarkup 接受/拒绝审批仍在开发计划中。CriticMarkup 五种可见审阅标记、静态学习闪卡、Cloze、Kbd、脚注、Mermaid、Chat、LinkCard、Tabs 和部分稳定块锚点已支持。

## 新增：Astryx 对话、链接卡片、脚注与 Mermaid

### Chat / Message（原生 Astryx 组件）

对话记录是结构化、可搜索和可编辑的 Markdown。外层必须比内层围栏的冒号更多；建议用 **四个冒号包裹整个 Chat，三个冒号包裹每条 Message**，否则标准 Directive 解析器可能提前结束外层容器。

~~~~markdown
::::chat

:::message[Agent A]{sender=assistant}

建议优先保留 **Markdown 保真**。

:::

:::message[User]{sender=user}

同意，同时考虑安全和可访问性。

:::

::::
~~~~

`sender` 当前支持 `assistant`、`user`、`system` 三个布局角色；其余发言者名称可写在方括号内。可视化复用 Astryx 的 `ChatMessageList`、`ChatMessage` 和 `ChatMessageBubble`。Chat 是聊天记录排版，不会执行 Agent 指令。

### LinkCard（Astryx Card）

使用单独一行的叶节点 Directive。标题可选；页面标题、描述、图片、站点名均为动态显示数据，**不会持久化到 Markdown**：

~~~~markdown
::link-card[Recalloom 源码]{url="https://github.com/RavelloH/Recalloom"}
~~~~

卡片复用 Astryx Card，URL 可在可视化编辑器中修改。元数据由客户端向 Meta API 请求，**请求前去掉查询参数和锚点、保留协议/域名/路径**，但不修改原 Markdown URL。例如 `https://example.com/post?id=12#intro` → 只把 `https://example.com/post` 发送给 Meta API。

图标、封面从 Recalloom 的登录鉴权图片代理加载；**图片 URL 本身的查询参数继续保留**，否则可能破坏图片签名或尺寸变体。UI 图标仍只使用 Lucide。

### 文档内 YAML 字样不是 Recalloom 元信息

Recalloom **不支持 YAML Front Matter 作为文档元数据**，不推荐通过 Markdown 正文的 `title:`、`tags:`、`status:` 等字段管理文件属性。标题、标签、路径、状态等元信息应通过 Recalloom 自身的文件/记录 API 和数据库字段管理，具有独立的修改历史与权限语义。

如果文档开头恰好存在 `---` 或 `+++` 包裹的 YAML/TOML 风格文本，Recalloom 只会把它当作 **普通可编辑文本** 显示，保留原始字符与换行；不会生成元信息卡片、解释键值、执行标签或同步数据库。Wiki 嵌入也只会原样显示该文本，不会把它当成文件元信息。

~~~~markdown
---
title: 这是用户写的普通内容
tags: [示例, 原始文本]
---
~~~~

上述例子只说明兼容已有文本，不是推荐的元信息写法；新文档不应该主动生成这样的头部。

### 图片尺寸与图注（支持：独立图片、可视化编辑）

独立成段的标准 Markdown 图片允许附加受限的呈现属性，推荐语法如下：

~~~~markdown
![控制系统框图](https://example.com/diagram.png){width=480 caption="系统结构示意图"}

![实验装置](https://example.com/equipment.png){width=600 height=400 caption="实验平台"}
~~~~

仅支持独立成段图片后的单行 `{width=数值 height=数值 caption="文字"}`，属性均可选，顺序不限；宽度和高度为 40～1800 的整数像素，实际显示不超过容器宽度。普通图片 `![描述](url)` 继续可用，原 Markdown 图片标题（title）与图注（caption）分开。点击可视化图片后可以用 Astryx 输入控件调整尺寸或图注；只有用户真正修改内容才创建修订。Wiki 嵌入会安全展示图注，但不把它当作文档元信息。包含未知属性、跨行属性、非独立图片或非法数值的写法不解析为增强图片，保留为原文字。

### 图、公式和表格的显式稳定 ID 与交叉引用

以下是 **Markdown 正文自身的内容结构**，不是文件/记录元信息。只有需要交叉引用的图片、块级公式或 GFM 表格才添加 `fig-`、`eq-`、`tbl-` 开头的显式 ID；编号按当前文档中的出现顺序实时计算，**不会写入正文，更不会新增 D1 块表**。

~~~~markdown
![电路结构](circuit.png){#fig-circuit width=480 caption="电路结构图"}

$$
P=UI\cos\varphi
$$ {#eq-power}

| 参数 | 数值 |
| --- | ---: |
| 电压 | 220 V |
| 电流 | 5 A |

: 系统参数 {#tbl-params}

参见 @fig-circuit、@eq-power 和 @tbl-params。
~~~~

可视化编辑器把引用显示为“图 1”“公式 1”“表 1”等可点击的目标链接；没有匹配定义的 ID 显示“引用不存在”，不会改绑到其他块。图片在选中后可编辑图注、尺寸和图 ID；块级公式通过原有公式对话框修改 LaTeX 与公式 ID；表格在表格工具栏中点击“表注”修改标题和 ID。修改不引用的内容、打开编辑器或渲染编号均不能创建修订。

图片属性必须在 **独立图片** 后的同一行；公式闭合符号必须独立以 `$$ {#eq-power}` 形式结束；表注必须是紧挨 **GFM 表格后**的独立段落 `: 标题 {#tbl-id}`。表注不属于文件元信息，Markdown 以表格正文加紧随的标题行保存。有效 ID 必须唯一，类型前缀和 ID 长度均受约束；代码块、行内代码、链接文字，以及使用反斜杠转义的 `\@fig-circuit` 不会被解析成引用。HTML 实体中的 `&#64;` 也不能凭空生成引用；无法可靠还原原始标记时按普通文本展示。

`@fig-`、`@eq-`、`@tbl-` 是 **当前文档内部** 的相对块引用，跨文档仍应使用 Wiki UUID+明确章节/段落锚点，不要错误把 ` @fig-id` 当作数据库中的全局引用。图、公式和表格的编号也支持只读 Wiki 投影，依然从 Markdown 按需计算，不建立持久化块索引。

### 术语定义列表（支持：边界明确的结构化 Glossary）

避免使用 `*[DO]: Durable Objects` 或无闭合边界的缩写形式，以免无法确定解释的结束位置。推荐使用显式嵌套容器：

~~~~markdown
::::glossary[核心术语]

:::definition[DO]

**Durable Objects**：提供有状态计算能力。

:::

:::definition[D1]

Cloudflare 的 SQL 数据库。

- 支持查询
- 支持版本记录

:::

::::
~~~~

外层 `::::glossary` 收纳多个术语，内层 `:::definition[术语]` 确定每项的完整内容边界。术语名和定义正文均可在 Tiptap 中直接编辑，定义支持段落、加粗、列表等普通 Markdown，整体保持源码往返。使用斜杠命令“术语定义列表”可以直接插入示例结构。该语法不是文件元数据，也不会修改 Recalloom 数据库中的标签或属性。

### GFM 脚注（支持可编辑引用与定义）

~~~~markdown
结论需要补充来源[^source]。

[^source]: **来源**以及补充说明。

[^long]: 多段解释。

    - 可以在定义里写列表
    - 仍使用 Markdown 源码保存
~~~~

可视化中 `[^source]` 是脚注引用节点，定义以 Astryx 风格卡片可编辑。修改其他正文时，脚注不会退化为原文回退块；只读视图由 GFM 解析。请确保引用 ID 与定义 ID 对应。

### Mermaid（按需、安全图表）

~~~~markdown
~~~mermaid
flowchart LR
  A[Markdown 源码] --> B[可视化编辑器]
  B --> C[Markdown 源码]
~~~
~~~~

可视化保留可编辑的 Mermaid 代码围栏，并在其旁显示图表；只读 Markdown 也显示图和源代码。采用 Mermaid `securityLevel=strict`、拒绝 `%%{init:...}%%` 等自定义配置指令，生成的 SVG 还要经过 DOMPurify 净化。解析错误只显示提示，不改变原始代码。

### 本阶段仍未实现

多列布局、间隔重复调度、动态查询、列表项/表格单元格自动块 ID 和 CriticMarkup 接受/拒绝审批工作流仍在规划中；CriticMarkup 的五种可见审阅标记、Tabs、标题 {#id} 与段落 ^block-id 已在后文说明。

## Astryx Tabs（支持）

使用更长的四冒号围栏包裹多个三冒号的选项卡，防止内部围栏结束外层。选项卡标题为可编辑的结构化属性；每个面板可以包含段落、列表、公式、图片和其他普通 Markdown。

~~~~markdown
::::tabs

:::tab[概览]

这是 **项目概览**。

:::

:::tab[实现]

- Markdown 源码为唯一权威
- 可视化编辑不得丢失任何标签内容

:::

::::
~~~~

在唯一的**可视化编辑模式**中，Astryx TabList 直接切换当前可见面板；点击后立刻在选中面板内编辑段落、列表等富文本。未选中的面板仅在 CSS 中隐藏，**仍完整保留在 ProseMirror 文档结构中**。切换或保存不得丢失正文，UI 切换本身也不创建新版本。超过 32 个面板时保守显示全部以避免隐藏不可操作内容。

## 稳定标题与段落锚点（支持）

Markdown 标题可以添加固定 ID，避免修改标题文字后导致链接失效。仅支持 ASCII 字母开头、后接字母/数字/连字符的 1–80 字符 ID；需在同一文档中保持唯一。

~~~~markdown
## 核心结论 {#stable-conclusion}

这一段可独立引用。 ^result-block

下一段没有块 ID。
~~~~

- `{#stable-conclusion}` 仅适用于 Markdown 标题；可视化时不显示控制语法，导出时保留。
- `^result-block` 仅支持位于普通段落结尾的块 ID；可视化隐藏标记，但原 Markdown 保留 ID。
- 阅读模式和可视化编辑器使用一致的 DOM 锚点，例如 `#user-content-stable-conclusion` 和 `#user-content-result-block`，并遵守 HTML 安全过滤。
- WikiLink 与只读嵌入可用文档 UUID 和固定锚点，例如 `[[id:11111111-1111-4111-8111-111111111111#stable-conclusion]]`、`{{embed:id:11111111-1111-4111-8111-111111111111#^result-block}}`；段落嵌入只取该段落，不会自动包含整个章节。
- 当前**不保证**为列表项、表格单元格、公式块自动分配块 ID；显式标题 ID 与段落 ID 必须自行避免重复。更多块级节点支持在后续迭代。

## CriticMarkup：可见的审阅建议（支持五种行内标记）

CriticMarkup 用于 Agent、人类之间的审阅、建议和讨论。**标记只是提出修改或批注，不会自动应用到正式正文，也不会触发任何 Agent 操作。** 与隐藏注释不同，批注在可视化编辑、只读 Markdown 和源码中都可见；可视化里变暗、字号略小，仍可检索与编辑。

~~~~markdown
建议增加这段：{++新增的建议内容++}。

建议删除这一段：{--已过时的说法--}。

建议替换：{~~原始说法~>建议说法~~}。

需要强调的审阅位置：{==待复核的数据==}{>>Agent A：请先核查来源<<}。

独立审阅批注：{>>此处需要进一步查证<<}。
~~~~

- `{++新文本++}`：建议增加，采用轻微绿色底纹和下划线。
- `{--旧文本--}`：建议删除，原文**保持可见**，弱化并加删除线。
- `{~~旧文本~>新文本~~}`：建议替换，同时显示旧文本（删除线）与新文本（虚线下划线）；可视化只直接编辑建议的新文本，修改旧文本请切换到源码模式。
- `{==重点==}`：审阅重点，区别于普通 `==GFM 高亮==`，会保留双侧花括号语法。
- `{>>评论<<}`：审阅批注，小字号、弱化颜色及轻边框，但绝不完全隐藏。

当前仅解析**单行、简单文本、不嵌套**的 CriticMarkup；不要把换行、另外一组 CriticMarkup、复杂内联 Markdown、数学公式或 HTML 放进标记内部。无法确认的标记、代码块、行内代码、普通 Markdown 链接和 HTML 内的内容不得被错误当作审阅标记；保留原始 Markdown。暂未提供接受/拒绝建议的按钮或审批流程，也不会把 CriticMarkup 自动转为正式修改。

例如多个 Agent 可按 `{>>Agent A：评论正文<<}` 写明来源；当前这只是可见文本，没有验证的作者身份、权限或时间戳，正式多 Agent 审阅工作流仍需另行设计。

### 主题对比度、Mermaid 图表与链接图标（适用于当前版本）

代码围栏仍用 Shiki，而不是 GPU Lexer。深色和浅色使用 GitHub high contrast 双主题，跟随 Recalloom 当前实际主题（data-effective-theme）；不要仅凭操作系统 prefers-color-scheme 决定代码的着色。代码块标题、编辑区域、滚动区域和四角采用同一主题背景，不应出现白色边角、浅色代码在深色背景中看不清等现象。

Mermaid 图表的主题也和 Recalloom 实际主题一致，采用明确的高对比节点文字、边框与连线配色。切换主题时可以重新绘制**仅作为展示的图像**；绘图仍须在 strict 安全模式中进行，净化的 SVG 仅作为 img 显示，不能将可执行的 SVG/HTML 插入 ProseMirror。图形不会覆盖用户保存的 Mermaid Markdown 源码。

外链 Favicon 与 LinkCard 图标在两种主题下使用中性浅灰至深灰的微渐变底板、圆角和细边框，帮助透明的深色或浅色站点标志保持可见。编辑器中的图标只能通过外部 CSSOM 样式渲染，**不得写入 Tiptap/ProseMirror 管理的 DOM 属性或内联 style**；此前这种写法曾导致长文档无限重排和浏览器内存暴涨。图标与元数据请求不能使文档出现未保存状态。

## 学习闪卡与快捷键键帽（支持）

闪卡推荐使用四冒号包裹三冒号，以防内层面板提前结束外围栏。闪卡内容以 Markdown 正文保存，不建立额外的闪卡数据库，也不自动记录复习次数。

~~~~markdown
::::flashcard[知识测验]

:::front[问题]

Recalloom 的数据版本保存在什么地方？

:::

:::back[答案]

版本化内容保存在 **D1**，并保留来源和修订记录。

- 不应自动接受 CriticMarkup 的建议
- 支持普通列表、公式和 WikiLink

:::

::::

按 :kbd[Ctrl+Shift+P] 打开命令面板。
~~~~

在 **Notion 式可视化编辑器**中，`flashcard`、`front`、`back` 都是可编辑 Tiptap 块。默认展示问题并收起答案；点击 Astryx“显示答案”按钮即可**直接在可视化编辑器内**展开并编辑答案，完成后仍可收起。隐藏的答案从不卸载 ProseMirror 内容节点。切换按钮与揭示状态只是本地表现，不构成文档修订，也不能被解释为删除操作。Wiki 只读嵌入只是安全投影，不是第三种文档模式。普通注释仍始终可见，仅淡化显示。

`:kbd[Ctrl+Shift+P]` 是单个键帽的 Markdown 指令，不会解释成按键事件，不会执行操作。它使用等宽字体、中性背景与细边框，保留原始文字。用户想显示逐个按键时可分开写作 `:kbd[Ctrl] + :kbd[Shift] + :kbd[P]`。

目前支持静态知识闪卡和交互式 Cloze 挖空，但不提供 **间隔重复算法、复习统计、提醒、自动评分或多 Agent 审阅通过**。这些功能必须另行设计，不能由普通文本伪装为已支持。

无效或未知的容器仍按未知语法安全回退；代码块内的 `:kbd[...]` 和 `::::flashcard` 必须保留为代码，不能转换成富文本组件。

### Cloze 挖空（支持：可视化编辑器内揭示并直接编辑）

直接使用明确的 Directive 语法，而不是 `{{...}}`。这避免了与 Recalloom 的 `{{embed:id:UUID}}` Wiki 嵌入和普通模板标记冲突：

~~~~markdown
Cloudflare 的 Durable Objects 缩写为 :cloze[DO]{hint="首字母 D"}。

稳定版本在 :kbd[Ctrl] + :kbd[S] 后保存。
~~~~

`:cloze[答案]` 和 `:cloze[答案]{hint="提示"}` 在**可视化编辑器**中默认隐藏答案并显示提示，点击后直接揭示**仍然可以编辑的 Tiptap 文本**，再次点击即可收起。答案节点始终挂载，展示状态变化不写回 Markdown。只有修改答案才是真正的编辑，触发保存。Wiki 只读嵌入沿用展示交互，但不是独立文档模式。hint 只是展示提示，不允许脚本、HTML 或自动操作。

当前 Cloze 仅支持简单单行文本答案、不嵌套其他 Directive。想在同一段落放多个答案，可以使用多个 `:cloze[答案]`。脚注、WikiLink、数学公式等复杂内容应放在 Cloze 外部，避免解释歧义。
