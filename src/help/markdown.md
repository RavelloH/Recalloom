# Markdown 与扩展语法

Recalloom 的 Markdown **源码编辑**与**预览**基于 CommonMark/GFM、remark-math 和受限 HTML；**可视化编辑器**使用 Tiptap，个别 HTML 或不支持的特殊语法可能以普通文本呈现。写入正文不等于保证所有 HTML 或所有编辑模式都能无损可视化。

## 标准 Markdown 与 GFM

支持标题（# 至 ######）、段落、粗体、斜体、删除线、行内代码、代码围栏、链接、图片、引用、水平分隔线、无序/有序列表、任务复选框及表格。表格与代码过宽时，预览会允许横向滚动。

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

- 文本高亮（推荐）：<mark>重要结论</mark>。编辑器还识别 ==重要结论==，但跨编辑/预览模式优先采用 HTML mark。
- 下划线：<u>下划线</u>。
- 上下标：x<sup>2</sup> 和 x<sub>n</sub>。
- LaTeX 数学公式：行内 $E=mc^2$、块级独立 $$ 行；详见 math。
- WikiLink 和只读嵌入：[[id:UUID]]、[[/绝对路径.md]]、{{embed:id:UUID}}；详见 wiki。
- 段落、标题、表格单元格的有限对齐支持；可视化编辑器序列化部分对齐为 HTML style，预览仅认可 left/center/right，并经安全过滤处理。

## mark 可以包裹哪些内容？

除了文字，支持嵌套部分行内格式（例如行内代码），也支持完整行内 KaTeX 公式与块级公式。但**块级公式必须独立成块并遵循专门换行结构**，见 math 的示例。

~~~markdown
<mark>结论及 `U_N` 需要重点记忆</mark>

<mark>$\frac{U_1}{U_2}$</mark>
~~~

不要推断 <mark> 可以包住任意多个 Markdown 段落、任意 HTML 标签或任何复杂块。推荐仅使用经过实现和测试覆盖的组合。

## HTML 安全边界

预览使用 rehype-raw、rehype-sanitize，允许部分 HTML 标签和属性；任意 script、任意样式、嵌入 iframe、任意自定义 HTML 元素均不能依赖其正常渲染。可视化编辑器遇到无法安全识别的 HTML 或 YAML front matter，可能保留为可编辑的字面文本。脚注等 GFM 扩展在可视化模式的往返保真度不作统一保证；遇到特殊文档应使用源码模式核对。

**选择模式的建议**：复杂公式、高亮和 Wiki 语法可以按本帮助写入 Markdown；不常见 HTML/混合格式请先通过 dryRun 或源码编辑核对，不要无条件假设可视化编辑器会保留所有语义。
