# RMD 1.0：Markdown 与扩展语法

Recalloom 的**文档正文只存 Markdown**，不把渲染树、Tiptap JSON、目录、文件属性或数据库元信息混进正文。标准 Markdown 使用 CommonMark/GFM，扩展使用本页约定的 **RMD 1.0**。这是 Agent 应当生成的语法，不是对旧版 Directive 的别名表。

**RMD 1.0 的全部组件形式与全部 `@ attrs` 参数**不再依靠手工表格维护，而是根据唯一的 `src/rmd/registry.json` 自动生成，完整参数规格表已经附在本帮助文档末尾，并同时生成仓库的 `docs/rmd-syntax-reference.generated.md`。可直接调用：

- `get_help({topic:"markdown",component:"badge"})`：只返回 Badge 的可选参数、取值、示例与回退规则。
- `get_help({topic:"markdown",component:"mark",kind:"block"})`：只返回 Mark 的块级形式；省略 `kind` 会返回同名组件的全部形式。
- `get_help({topic:"markdown",component:"tabs"})`：查看父子约束及完整的嵌套例子。
- `get_help({topic:"markdown",node:"image"})`：仅返回图片 `@ attrs` 的字段说明；`node` 还支持 `heading`、`paragraph`、`math`、`table`、`code`。

所有未知组件、未知节点、无效查询组合均会被拒绝，禁止 Agent 猜测不存在的属性。CodeMirror 源码编辑器从同一注册表提供 `::`、`:::`、参数名、枚举值与 `@ attrs` 候选补全，不会擅自插入不支持的组件。

完整覆盖八种 Callout、九色 Highlight、五类行内组件、Details/Tabs/Flashcard/Glossary/Chat、注释与 CriticMarkup、图片/表格/公式/代码修饰、WikiLink/Embed 的可复制示例见仓库 `docs/rmd-1.0-syntax-showcase.md`，其内容会通过自动化测试实际解析并验证规范化保存不漂移。

可视化模式中，合法的 `@ attrs … @` 显示为**可点击、可键盘聚焦的灰色斜体属性按钮**，支持直接编辑标题、段落、公式、表格、代码和图片的节点属性。点击后修改 ID、图注、尺寸、代码文件名或开关，点击「保存属性」只更新本地草稿，再点击整篇文档的「保存」才会落库；取消或非法 ID 不写入。没有必要切换到源码模式才能修改已有属性。纯公式的块级 Mark 仅包裹公式宽度并居中，含正文的 Mark 仍是普通块；表格及公式属性在两种视图中均居中。

界面有可视化编辑、源码编辑和只读预览三个视图；**前两种可编辑，预览不执行编辑**。打开、切换、渲染、展开 Details、揭示 Cloze、切换 Tabs 或阅读 Wiki 嵌入均不应创建修订。只有真正修改草稿并明确保存，才会产生正文版本。

## 标准 Markdown 与数学

支持标题、段落、粗体、斜体、删除线、行内代码、代码围栏、链接、独立图片、引用、多级列表、任务复选框、GFM 表格、GFM 脚注、数学和 Mermaid 代码块。高亮与代码、数学等复杂结构组合时应使用以下 RMD 1.0 包装，不直接依赖 HTML 的嵌套解析。

~~~~markdown
## 电路分析

**电压**、*电流*、~~已删除~~、`const U = 220`

> 第一段引用。
>
> 第二段引用。

- [x] 完成实验
- [ ] 整理记录

| 名称 | 值 |
| --- | --- |
| 电压 | 220 V |

行内：$U=IR$

$$
P=UI
$$

~~~mermaid
flowchart LR
  A[开始] --> B[结束]
~~~

参考脚注[^sample]。

[^sample]: 这是普通 GFM 脚注。
~~~~

数学使用 remark-math 和 KaTeX，不是完整的 LaTeX 编译器。块公式的两个 `$$` 必须独占一行。详细用法参见 `get_help({topic:"math"})`。

## 两种独立的标记：Mark 和 Highlight

**Mark** 是不带颜色参数的语义标记。其现有黄色观感（默认 `#f5d870`）、公式高度自适应与块公式整体背景已确定为视觉基线，不能因为解析管线重构而改变。**Highlight** 则必须明确指定颜色，不等于 Mark 的“黄色变体”。

~~~~markdown
这是 :: mark 重点结论 ::。

公式也可以 :: mark $\frac{U_1}{U_2}$ ::。

这是 :: highlight 高风险 | red ::。
这是 :: highlight 已验证 | green ::。
这是 :: highlight 普通强调 | color=yellow ::。

::: mark

$$
\frac{U_1}{U_2}=k
$$

:::

::: highlight | color=blue

这整个块采用蓝色强调。

:::
~~~~

Highlight 可用颜色：`red`、`orange`、`yellow`、`green`、`blue`、`purple`、`pink`、`cyan`、`teal`。行内语法用 `:: mark 内容 ::`、`:: highlight 内容 | red ::`；块级语法用 `::: mark`、`::: highlight | red` 和独占一行的闭合 `:::`。

**不能使用 `==文本==` 作为 Mark**：`a == b 且 c == d` 是普通比较表达式。旧的 `<mark>…</mark>`、`:highlight[...]{...}` 也不是 RMD 1.0 的规范输出格式。

## RMD 1.0 统一语法和参数规则

- **行内组件**：`:: 名称 主内容 | 位置参数 | key=value ::`。起止双冒号前后均有空格；仅处理完整、已闭合的单行组件。
- **块容器**：独立一行 `::: 名称 可选标题`，内部是普通 Markdown，再用独占一行的 `:::` 闭合。外层嵌套时使用更长的冒号围栏。
- **块级单行组件**：`::: embed 目标 :::`、`::: link-card URL | title=标题 :::`。
- **块属性**：`@ attrs 标识符 | key=value @`。标识符可省略、可用 `| id=...` 指定；同一行的合法修饰符或紧随块后的独立修饰行会依附于相应 Markdown 节点。
- 使用空格包围的 ` | ` 分隔参数，**位置参数必须在具名参数前**。重复属性、未知参数、非法枚举、未闭合语法不得产生部分组件。
- 简单参数可不加引号；含空格两侧的竖线、引号或反斜杠等特殊内容，用 **JSON 风格双引号**和 JSON 转义；不要使用单引号冒充 JSON 字符串。
- 标识符 `id` 以 ASCII 字母开头，后续只能是字母、数字或连字符，总长不超过 80，存储时规范为小写；生成时尽量直接用小写。ID 是 Markdown 内容内的局部标记，不是记录 UUID 或数据库元数据。

~~~~markdown
状态：:: badge 已完成 | success ::

解释：:: tooltip Durable Objects | description="提供持久存储与计算" ::

自定义属性：## 标题 @ attrs chapter-one @

无显式 ID 的图片：
![示意图](device.png) @ attrs | width=480 | caption="包含空格的图注" @
~~~~

不能将属性语法当作 YAML Front Matter 或 `manage_record` 的替代品。权限、路径、标签、标题等**记录元数据仍通过相应 API 管理**。

## Callout / Banner

保留 8 种独立语义和各自图标：`note`、`info`、`tip`、`success`、`warning`、`danger`、`example`、`question`。外观沿用现有 Astryx 组件。`question` 是可独立使用的提示，不是闪卡的 `front`。

~~~~markdown
::: note 学习笔记

保存具体结论。

:::

::: warning 部署前检查

- 检查数据备份
- 确认迁移版本

:::

:::: tip 展开嵌套内容

外层需要四个冒号。

::: example 内层示例

**这里仍可编辑 Markdown。**

:::

::::
~~~~

合法的 GitHub `> [!NOTE]`、`[!TIP]`、`[!IMPORTANT]`、`[!WARNING]`、`[!CAUTION]` 可以作为**外部输入**解析为相应 Callout；Agent 新写内容应使用 RMD 格式，不能依赖兼容输入形式。

## 行内组件

~~~~markdown
:: badge 就绪 | success ::
:: badge 待检查 | warning ::
:: badge 高风险 | danger ::
:: badge 信息 | info ::
:: badge 普通 | neutral ::

:: tooltip DO | description="Durable Objects 的缩写" ::
:: abbr API | description="Application Programming Interface" ::
:: kbd Ctrl :: + :: kbd Shift :: + :: kbd P ::
:: cloze 额定电压 | hint="点击查看答案" ::
~~~~

Badge 变体固定为 `neutral`、`info`、`success`、`warning`、`danger`。不支持的 `icon`、`color`、`placement` 等参数应保留为原文，不能声称其已生效。提示文本可以有空格；需要精确保留特殊字符时用带引号的具名 `description` / `hint` 参数。

## 容器和结构化学习组件

Details 展开与收起不修改 Markdown，Tabs 切换不隐藏或丢弃其他选项内容。子容器只有放在正确父容器内才合法：`tab` 在 `tabs` 中，`message` 在 `chat` 中，`front` / `back` 在 `flashcard` 中，`definition` 在 `glossary` 中。

~~~~markdown
::: details 详细说明

可折叠的 Markdown 正文。

:::

:::: tabs

::: tab 总览

概述内容。

:::

::: tab 参数

| 电阻 | 阻值 |
| --- | --- |
| R1 | 10 kΩ |

:::

::::

:::: flashcard

::: front

电压、电流与电阻的关系？

:::

::: back

$U=IR$

:::

::::

:::: glossary

::: definition 额定电压

设备设计运行的电压值。

:::

::::

:::: chat

::: message Agent | sender=assistant

这是助手消息。

:::

::: message 用户 | sender=user

这是用户回复。

:::

::::
~~~~

嵌套冒号数量严格匹配：外层必须长于内部子容器，孤立 `::: tab` 或未闭合容器保留为普通原文。为避免异常输入触发递归解析放大，RMD 容器最多嵌套 **10 层**，定界冒号围栏最多 **64 个字符**；超过上限的片段按原文显示，不作部分提升。

## 注释与审阅建议

RMD 注释在**可视化编辑器**内低强调度显示、可直接修改；在**只读预览及 Wiki 嵌入**中隐藏且不留错误标记。支持单行 `%%内容%%` 和独立界定行构成的多行 `%% … %%`；代码块、行内代码、公式或转义后的 `%%` 都不应误解析。未闭合的注释保持原文。

~~~~markdown
实际正文 %%需要再次核实计算结果%%。

%%
这两行属于一条
多行内部注释。
%%

增加建议：{++新增文字++}
删除建议：{--原有文字--}
替换建议：{~~旧文字~>新文字~~}
强调建议：{==重要==}
批注建议：{>>请核实数值<<}
~~~~

CriticMarkup 只在可视化模式中提供明确的接受、拒绝、解决操作；**只读预览显示未接受建议时的已确认正文**，不会擅自将新增/替换内容当成正式正文。接受与拒绝改变草稿，实际版本更新仍要明确保存，不能用批注作为 Agent 授权指令。

## 图片、表格、代码、公式与稳定 ID

~~~~markdown
## 设备说明 @ attrs chapter-device @

这段有自己的块 ID。 @ attrs paragraph-device @

![电路结构](circuit.png) @ attrs fig-circuit | width=480 | caption="电路结构图" @

$$
P=UI
$$
@ attrs eq-power @

| 参数 | 值 |
| --- | --- |
| 电压 | 220 V |
@ attrs tbl-params | caption=系统参数 @

~~~ts
const value = 42;
~~~
@ attrs code-example | file=example.ts | wrap=true | expand=false @

参见 [[#fig-circuit]]、[[#eq-power]] 与 [[#tbl-params]]。
~~~~

`fig-`、`eq-`、`tbl-` 前缀的有效 ID 可供同文档交叉引用，并按文档顺序临时计算“图 1 / 公式 1 / 表 1”等编号；编号不是数据库字段。图、公式、表格的 ID 可以用作 Wiki 嵌入锚点。代码块当前仅支持 `file`、`wrap`、`expand` 属性；没有实现的行号、行高亮等字段不可擅自写入。图片尺寸为正整数（实际呈现受组件尺寸范围约束）。

## Wiki 文档链接与嵌入

~~~~markdown
[[id:550e8400-e29b-41d4-a716-446655440000]]
[[id:550e8400-e29b-41d4-a716-446655440000|显示别名]]
[[/Projects/示例.md#结果]]

::: embed id:550e8400-e29b-41d4-a716-446655440000 :::

::: embed /Projects/示例.md#结论 :::

::: link-card https://example.com | title=示例页面 :::
~~~~

上方 UUID 和路径仅作为**语法示例**，不保证对应真实文档。真正创建链接时先通过检索或 `resolve_path` 获取权威 UUID。Wiki 嵌入始终只读，具备循环、深度和长度约束，不会修改源文档。GFM 表格里的 Wiki 别名竖线使用共享词法保护，不应误切成额外列；已有反斜杠转义 `\|` 同样可以识别。

## 外部 HTML 与无效语法的边界

简单 `<kbd>Ctrl</kbd>`、`<details><summary>标题</summary>正文</details>`、`<br>` / `<br/>` 等常见 HTML 可以作为外部输入映射至已支持节点；标准 Markdown 允许的 `<u>下划线</u>`、`<sup>上标</sup>`、`<sub>下标</sub>` 在可视化中会转换为真正可编辑的文字样式，并在规范序列化后保留。恶意、不配对或未知 HTML 不会被自动升级为可执行组件。新写 RMD 扩展应遵循统一语法。复杂未知 HTML、恶意属性和脚本不会被当作可信组件执行。

**安全不变量**：不认识或格式无效的 RMD 片段必须保持可编辑原文；不允许吞掉文字、重排普通 `==` 比较、让代码围栏执行注释/组件，也不能仅因为打开文档、看预览或切换模式而生成新版本。未知片段在修改其他段落后仍应尽可能保持原始内容。

旧版 `:badge[完成]{variant=success}`、`:tooltip[文本]{content="…"}`、`:::warning[标题]`、`{#eq-id}`、`@eq-id`、`{{embed:…}}` 等不属于 RMD 1.0 的规范输出；不要在新文档或 Agent 工具输出中继续使用。若必须保留现有旧文件，请在源码模式人工迁移并核对内容。

开发维护及回归清单参见 `docs/rich-markdown.md`。
