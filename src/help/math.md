# RMD 1.0：KaTeX 数学与 Mark / Highlight

Recalloom 的数学输入是 Markdown 中的 `remark-math`，输出由 KaTeX 排版；**不是完整的 LaTeX 文档编译器**。数学公式只存储于正文，不建立额外数据库索引或渲染缓存作为事实来源。

## 行内与块级公式

~~~~markdown
欧姆定律：$U=IR$。

分式：$\frac{U_1}{U_2}$。

$$
\begin{aligned}
U &= IR\\
P &= UI
\end{aligned}
$$
~~~~

行内仅使用一对 `$`；块级 `$$` 开头和结尾均必须独占一行。KaTeX 支持 `\frac`、`\sqrt`、`\sum`、`aligned`、`matrix` 等语法；不支持引入任意宏包、执行脚本或 `\begin{document}`。复杂分式和多行公式的盒子可能高于正文行高，布局要以 KaTeX 的实际高度计算。

## Mark：保持现有黄色视觉

Mark 是**没有颜色参数**的默认标记，它与彩色 Highlight 是两种独立的 RMD 语义。用户确认现有黄色 `#f5d870`、文字的圆角/内边距、内联公式的完整高度包裹，以及块级公式的一整块连续背景已足够好，重构时**必须保留这些观感**。

~~~~markdown
文字：:: mark 变压器短路阻抗 ::。

行内公式：:: mark $\frac{\Delta P_s U_N^2}{S_N^2}$ ::。

::: mark

$$
\begin{aligned}
R_T &= \frac{\Delta P_s U_N^2}{S_N^2}\times1000\\
X_T &\approx \frac{U_s\%}{100}\frac{U_N^2}{S_N}\times1000
\end{aligned}
$$

:::
~~~~

行内 `:: mark 正文 ::` 可包住完整数学节点；块级 `::: mark` 必须以独占一行的 `:::` 正确闭合。块数学在标记区域内仍居中、可滚动，背景不应被拆分成普通行高加公式扩展部分。

## Highlight：显式颜色

~~~~markdown
:: highlight 关键变量 | red ::

:: highlight $\frac{U_1}{U_2}$ | color=green ::

::: highlight | blue

$$
P=UI
$$

:::
~~~~

可选颜色是 `red`、`orange`、`yellow`、`green`、`blue`、`purple`、`pink`、`cyan`、`teal`。Highlight 必须有合法颜色，否则整个语法保持原文；不能把 `:: mark` 自动改写成黄色 Highlight。对九种颜色沿用当前浅色/深色视觉值，不因解析重构修改配色。

## 公式 ID 与本地引用

~~~~markdown
$$
E=mc^2
$$
@ attrs eq-energy @

如 [[#eq-energy]] 所示。
~~~~

公式的 `@ attrs` 是紧贴完整块公式的独立一行，不能写在 `$$` 闭合行内。合法 `eq-` 前缀供同文档按需编号和链接。ID 以 ASCII 字母开始，只能含字母、数字、连字符，长度不超过 80，并统一小写。

## 常见错误

- **不支持** `<mark>$...$</mark>`、`<mark>` 单独行包裹 `$$` 等旧开发版高亮语法作为新的规范输出；使用 `:: mark`、`::: mark`。
- **不支持** 裸 `==公式==`、`:highlight[公式]{color=red}`。
- 将 `$$x^2$$` 写在段落内不是约定的块级公式。
- 注释 `%%...%%`、RMD 组件、Wiki 引用不能在公式源字符串中被当成另一层可执行 Markdown。
- 代码围栏中的 `$...$` 和 `::: mark` 只是代码，不应触发数学或标记渲染。
- 即使 MathML/KaTeX 生成 HTML，内容仍是只读排版，不能执行任意用户 HTML 或 JS。

更多语法请读取 `get_help({topic:"markdown"})`，Wiki 章节定位及交叉引用参见 `get_help({topic:"wiki"})`。
