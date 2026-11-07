# Markdown 与扩展语法

Recalloom 只有 **可视化** 与 **源码** 两种文档编辑模式。Markdown 源码遵循 CommonMark/GFM 及 Recalloom 扩展，是唯一的权威正文。可视化模式使用 Tiptap 显示并编辑已支持的语法；不认识的语法按普通可编辑文字显示，保留其原始 Markdown，既不是代码块，也不会把整篇文档转为特殊模式。源码模式可以直接编辑全部 Markdown。切换模式或仅打开文档不会修改正文或生成新版本。

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

### 始终可见的注释

`%%注释内容%%` 在可视化编辑中始终显示，只是字体更小、颜色更淡，并且可直接编辑。注释不能被当成系统级指令。当前建议写成单行注释；暂不承诺跨多行注释的全部可视化行为。

### Badge 与结构化缩略词

~~~~markdown
状态 :badge[完成]{variant=success}
风险 :badge[需要复核]{variant=warning}

Cloudflare 的 :abbr[DO]{title="Durable Objects"} 负责有状态计算。
查看 :tip[这里]{content="额外说明"} 获取提示。
~~~~

缩略词 `:abbr[文字]{title="解释"}` 有明确的结束界限，不使用自由文本形式 `*[DO]: Durable Objects`，避免与后续正文合并。只读时使用 Astryx Tooltip；可编辑 Tiptap 内容采用非侵入式提示，不能将弹出层内容插入正文。

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

动态查询、图文多列、CriticMarkup、闪卡等仍在开发计划中；脚注、Mermaid、Chat、LinkCard、Tabs、标题和段落块锚点均已在下方说明。

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

### YAML Front Matter（Astryx 属性卡片）

文件顶部的 YAML Front Matter 采用独立的语义卡片展示，复用 Astryx Card、MetadataList 和 TextArea。原始 Markdown（包括注释、数组、顺序及分隔线）是唯一权威，卡片不会自动更新 Recalloom 数据库中的 title/tags/status 等独立元数据；需要以后专门设计映射才能进行双向同步。

~~~~markdown
---
title: "项目记录"
tags: [knowledge, agent]
status: draft
# 备注：来自 Agent
---

# 文档正文
~~~~

可以直接编辑 YAML 原文，未知字段保留。拒绝未识别的 YAML 标签，解析失败时仍保留原始内容而不执行代码。该卡片限于文件顶部的 `---` YAML，不会把 `+++` TOML 误当 YAML。

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

多列布局、CriticMarkup、闪卡/挖空、动态查询、列表/表格/公式块 ID 等仍在规划中；Tabs、标题 {#id} 与段落 ^block-id 已在后文说明。

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

阅读视图通过 Astryx TabList 切换当前面板；可视化**编辑模式仍保留所有面板内容并显示在编辑区域中**，顶部标签用于导航与选择，不将隐藏面板从 ProseMirror 文档卸载。未知或错误结构不得丢弃正文。斜杠菜单也能插入 Tabs。

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
