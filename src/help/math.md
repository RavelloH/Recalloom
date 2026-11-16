# 数学公式

Recalloom 使用 KaTeX 排版公式，支持分式、根式、求和、矩阵和多行对齐等常用 LaTeX 数学语法。可以在可视化编辑器中插入公式，再通过块编辑面板修改公式内容。

## 行内公式

在句子中使用一对 `$` 包围公式。

~~~~markdown
欧姆定律为 $U=IR$，电压比为 $\frac{U_1}{U_2}$。
~~~~

## 块级公式

需要独立展示时，将两个 `$$` 分别放在独立行上。

~~~~markdown
$$
\begin{aligned}
U &= IR\\
P &= UI
\end{aligned}
$$
~~~~

常用命令包括 `\frac{a}{b}`、`\sqrt{x}`、`\sum` 和 `\int`。多行公式可以使用 `aligned`，在换行处输入 `\\`，用 `&` 指定对齐位置。

## 标记重点公式

`mark` 使用黄色背景，可以标记行内公式，也可以包围独立公式。

~~~~markdown
重点公式 :: mark $\frac{\Delta P_s U_N^2}{S_N^2}$ ::。
~~~~

~~~~markdown
::: mark

$$
\begin{aligned}
R_T &= \frac{\Delta P_s U_N^2}{S_N^2}\times1000\\
X_T &\approx \frac{U_s\%}{100}\frac{U_N^2}{S_N}\times1000
\end{aligned}
$$

:::
~~~~

`highlight` 提供手绘荧光笔效果，默认黄色。可以通过 `color` 选择颜色，并在组件参考中查看笔触设置。

~~~~markdown
:: highlight $\frac{U_1}{U_2}$ | color=green ::

::: highlight | color=blue

$$
P=UI
$$

:::
~~~~

可选颜色为 `red`、`orange`、`yellow`、`green`、`blue`、`purple`、`pink`、`cyan` 和 `teal`。

## 给公式添加引用

在块级公式后紧接一行 `@ attrs`，设置以 `eq-` 开头的 ID，然后使用 `[[#ID]]` 引用它。

~~~~markdown
$$
E=mc^2
$$
@ attrs eq-energy @

如 [[#eq-energy]] 所示。
~~~~

ID 以字母开头，可以包含字母、数字和连字符，最多 80 个字符，保存时统一为小写。公式引用会按文稿中的顺序显示编号。

## 排版提示

- 用花括号组织上下标，例如 `x_{n+1}` 和 `a^{2}`。
- 公式中的文字使用 `\text{文字}`，百分号使用 `\%`。
- 数学命令、环境和宏采用 KaTeX 支持的范围。
- 长公式可以在公式区域内横向滚动，也可以拆分为多行。
- 代码块中的 `$...$` 按代码展示。

通过 Agent 查阅本主题时，可以调用 `get_help({topic:"math"})`。
