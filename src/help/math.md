# LaTeX 数学公式与高亮

Recalloom 使用 remark-math 解析 Markdown 数学语法，并通过 KaTeX 渲染。它支持 KaTeX 可解析的数学命令和环境（例如 \frac、\sqrt、\sum、aligned、matrix），**不是完整 LaTeX 编译器**，也不支持任意 LaTeX 文档、宏包或 \begin{document}。

## 行内公式

使用单个美元符号围住表达式：

~~~markdown
欧姆定律为 $U=IR$，电压比为 $\frac{U_1}{U_2}$。
~~~

## 块级公式

双美元符号各占**单独一行**，公式整体作为块级节点并居中显示：

~~~markdown
$$
\begin{aligned}
U &= IR\\
P &= UI
\end{aligned}
$$
~~~

含分式、矩阵或多行结构时，KaTeX 盒子可能高于普通文本行；可视化按照公式实际高度布局，长公式可以在受限宽度下滚动。

## 高亮文字与行内公式

外层 <mark> 不只用于文字，也能包住**完整的行内公式**，并让背景覆盖公式宽度与高度，而不是普通文本行高：

~~~markdown
<mark>重点：电压计算</mark>

<mark>$\frac{\Delta P_s U_N^2}{S_N^2}$</mark>
~~~

行内公式必须包含在同一个 <mark>...</mark> 中；不能仅高亮未闭合的公式片段。编辑器保存时会把公式和高亮一起序列化。

## 高亮块级公式：必须使用以下结构

~~~markdown
<mark>
$$
\begin{aligned}
R_T &= \frac{\Delta P_s U_N^2}{S_N^2}\times1000\\
X_T &\approx \frac{U_s\%}{100}\frac{U_N^2}{S_N}\times1000
\end{aligned}
$$
</mark>
~~~

关键规则：

1. 开头 <mark> 单独占行，结尾 </mark> 单独占行。
2. 两行 $$ 必须独立成行，且包住完整的 LaTeX 内容。
3. <mark> 与 $$ 之间可以有空行；不要在同一行插入其他正文或 HTML。
4. 一个高亮块级公式对应一个 <mark> 包裹块；不要假设任意混合段落的 HTML mark 都会被识别为公式高亮。
5. 在可视化编辑器中，它是带 highlighted 属性的块公式节点，整个公式只有一块高亮背景，按照公式实际尺寸扩展。

## 反例

- <mark>$$x^2$$</mark>（同一行的块公式包裹法并非受支持的块级模式）。
- 只写 <mark> 不写 </mark>，或只写一端的 $$。
- 在代码围栏内写数学表达式并期待它被当作公式：代码围栏只是代码。
- 将复杂 LaTeX 排版命令、外部宏包或完整 LaTeX 文档当作可执行渲染内容。

需要查看标准和额外 Markdown 语法时读取 markdown 帮助。
