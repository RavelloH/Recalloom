# RMD 1.0 完整语法参考

已定义 42 种语法形式、35 个不同组件名称及 6 类块属性目标。
行内使用 `:: 名称 正文 | 参数 ::`；多行块级使用独立的 `::: 名称` 和 `:::`；独立块级使用 `::: 名称 目标 :::`。
允许最多 10 层嵌套；围栏冒号不超过 64 个；超限、未知或非法语法全部保留原文。

## 组件目录

| 类别 | 组件 |
| --- | --- |
| 行内 | `mark`、`highlight`、`circle`、`box`、`bracket`、`underline`、`double-underline`、`dotted-underline`、`wavy`、`arrow`、`badge`、`tooltip`、`abbr`、`kbd`、`cloze` |
| 多行块级 | `note`、`info`、`tip`、`success`、`warning`、`danger`、`example`、`question`、`mark`、`highlight`、`circle`、`box`、`bracket`、`underline`、`double-underline`、`details`、`tabs`、`tab`、`chat`、`message`、`flashcard`、`front`、`back`、`glossary`、`definition` |
| 独立单行块级 | `embed`、`link-card` |

## 组件与参数详解

## `mark` · 行内

默认黄色语义标记，与彩色 Highlight 独立。

正文必填。

### 基本写法

将下面的占位内容替换为自己的文字。

~~~~text
:: mark 正文 [| 参数] ::
~~~~

### 参数

无具名参数。

### 示例

~~~~rmd-example
:: mark 重要结论 ::
~~~~

## `highlight` · 行内

手绘荧光笔（静态 SVG），支持文字和行内公式；颜色与笔触参数均可选。

正文必填。位置参数依次为 `color`，填写在具名参数前。

### 基本写法

将下面的占位内容替换为自己的文字。

~~~~text
:: highlight 正文 [| 参数] ::
~~~~

### 参数

| 参数 | 类型与取值 | 填写方式 | 默认值 |
| --- | --- | --- | --- |
| `color` | `color` · `red`、`orange`、`yellow`、`green`、`blue`、`purple`、`pink`、`cyan`、`teal` | 选填，可作第 1 个位置参数 | — |
| `stroke` | `sketch-stroke` · 0.5–6，最多两位小数 | 选填 | — |
| `padding` | `sketch-padding` · 0–24 CSS px，最多两位小数 | 选填 | — |
| `roughness` | `sketch-roughness` · 0–3，最多两位小数 | 选填 | — |
| `opacity` | `sketch-opacity` · 0.1–0.85，最多两位小数 | 选填 | — |

默认使用黄色手绘荧光笔效果，颜色选填。

### 示例

~~~~rmd-example
:: highlight 重要结论 ::
~~~~

## `circle` · 行内

手绘圈选（静态 SVG），支持文字和行内公式；颜色与笔触参数均可选。

正文必填。位置参数依次为 `color`，填写在具名参数前。

### 基本写法

将下面的占位内容替换为自己的文字。

~~~~text
:: circle 正文 [| 参数] ::
~~~~

### 参数

| 参数 | 类型与取值 | 填写方式 | 默认值 |
| --- | --- | --- | --- |
| `color` | `color` · `red`、`orange`、`yellow`、`green`、`blue`、`purple`、`pink`、`cyan`、`teal` | 选填，可作第 1 个位置参数 | — |
| `stroke` | `sketch-stroke` · 0.5–6，最多两位小数 | 选填 | — |
| `padding` | `sketch-padding` · 0–24 CSS px，最多两位小数 | 选填 | — |
| `roughness` | `sketch-roughness` · 0–3，最多两位小数 | 选填 | — |

### 示例

~~~~rmd-example
:: circle 重要结论 | color=blue ::
~~~~

## `box` · 行内

手绘方框（静态 SVG），支持文字和行内公式；颜色与笔触参数均可选。

正文必填。位置参数依次为 `color`，填写在具名参数前。

### 基本写法

将下面的占位内容替换为自己的文字。

~~~~text
:: box 正文 [| 参数] ::
~~~~

### 参数

| 参数 | 类型与取值 | 填写方式 | 默认值 |
| --- | --- | --- | --- |
| `color` | `color` · `red`、`orange`、`yellow`、`green`、`blue`、`purple`、`pink`、`cyan`、`teal` | 选填，可作第 1 个位置参数 | — |
| `stroke` | `sketch-stroke` · 0.5–6，最多两位小数 | 选填 | — |
| `padding` | `sketch-padding` · 0–24 CSS px，最多两位小数 | 选填 | — |
| `roughness` | `sketch-roughness` · 0–3，最多两位小数 | 选填 | — |

### 示例

~~~~rmd-example
:: box 重要结论 | color=blue ::
~~~~

## `bracket` · 行内

手绘括号（静态 SVG），支持文字和行内公式；颜色与笔触参数均可选。

正文必填。位置参数依次为 `color`，填写在具名参数前。

### 基本写法

将下面的占位内容替换为自己的文字。

~~~~text
:: bracket 正文 [| 参数] ::
~~~~

### 参数

| 参数 | 类型与取值 | 填写方式 | 默认值 |
| --- | --- | --- | --- |
| `color` | `color` · `red`、`orange`、`yellow`、`green`、`blue`、`purple`、`pink`、`cyan`、`teal` | 选填，可作第 1 个位置参数 | — |
| `stroke` | `sketch-stroke` · 0.5–6，最多两位小数 | 选填 | — |
| `padding` | `sketch-padding` · 0–24 CSS px，最多两位小数 | 选填 | — |
| `roughness` | `sketch-roughness` · 0–3，最多两位小数 | 选填 | — |

### 示例

~~~~rmd-example
:: bracket 重要结论 | color=blue ::
~~~~

## `underline` · 行内

手绘下划线（静态 SVG），支持文字和行内公式；颜色与笔触参数均可选。

正文必填。位置参数依次为 `color`，填写在具名参数前。

### 基本写法

将下面的占位内容替换为自己的文字。

~~~~text
:: underline 正文 [| 参数] ::
~~~~

### 参数

| 参数 | 类型与取值 | 填写方式 | 默认值 |
| --- | --- | --- | --- |
| `color` | `color` · `red`、`orange`、`yellow`、`green`、`blue`、`purple`、`pink`、`cyan`、`teal` | 选填，可作第 1 个位置参数 | — |
| `stroke` | `sketch-stroke` · 0.5–6，最多两位小数 | 选填 | — |
| `padding` | `sketch-padding` · 0–24 CSS px，最多两位小数 | 选填 | — |
| `roughness` | `sketch-roughness` · 0–3，最多两位小数 | 选填 | — |

### 示例

~~~~rmd-example
:: underline 重要结论 | color=blue ::
~~~~

## `double-underline` · 行内

双下划线（静态 SVG），支持文字和行内公式；颜色与笔触参数均可选。

正文必填。位置参数依次为 `color`，填写在具名参数前。

### 基本写法

将下面的占位内容替换为自己的文字。

~~~~text
:: double-underline 正文 [| 参数] ::
~~~~

### 参数

| 参数 | 类型与取值 | 填写方式 | 默认值 |
| --- | --- | --- | --- |
| `color` | `color` · `red`、`orange`、`yellow`、`green`、`blue`、`purple`、`pink`、`cyan`、`teal` | 选填，可作第 1 个位置参数 | — |
| `stroke` | `sketch-stroke` · 0.5–6，最多两位小数 | 选填 | — |
| `padding` | `sketch-padding` · 0–24 CSS px，最多两位小数 | 选填 | — |
| `roughness` | `sketch-roughness` · 0–3，最多两位小数 | 选填 | — |

### 示例

~~~~rmd-example
:: double-underline 重要结论 | color=blue ::
~~~~

## `dotted-underline` · 行内

点状下划线（静态 SVG），支持文字和行内公式；颜色与笔触参数均可选。

正文必填。位置参数依次为 `color`，填写在具名参数前。

### 基本写法

将下面的占位内容替换为自己的文字。

~~~~text
:: dotted-underline 正文 [| 参数] ::
~~~~

### 参数

| 参数 | 类型与取值 | 填写方式 | 默认值 |
| --- | --- | --- | --- |
| `color` | `color` · `red`、`orange`、`yellow`、`green`、`blue`、`purple`、`pink`、`cyan`、`teal` | 选填，可作第 1 个位置参数 | — |
| `stroke` | `sketch-stroke` · 0.5–6，最多两位小数 | 选填 | — |
| `padding` | `sketch-padding` · 0–24 CSS px，最多两位小数 | 选填 | — |
| `roughness` | `sketch-roughness` · 0–3，最多两位小数 | 选填 | — |

### 示例

~~~~rmd-example
:: dotted-underline 重要结论 | color=blue ::
~~~~

## `wavy` · 行内

手绘波浪线（静态 SVG），支持文字和行内公式；颜色与笔触参数均可选。

正文必填。位置参数依次为 `color`，填写在具名参数前。

### 基本写法

将下面的占位内容替换为自己的文字。

~~~~text
:: wavy 正文 [| 参数] ::
~~~~

### 参数

| 参数 | 类型与取值 | 填写方式 | 默认值 |
| --- | --- | --- | --- |
| `color` | `color` · `red`、`orange`、`yellow`、`green`、`blue`、`purple`、`pink`、`cyan`、`teal` | 选填，可作第 1 个位置参数 | — |
| `stroke` | `sketch-stroke` · 0.5–6，最多两位小数 | 选填 | — |
| `padding` | `sketch-padding` · 0–24 CSS px，最多两位小数 | 选填 | — |
| `roughness` | `sketch-roughness` · 0–3，最多两位小数 | 选填 | — |

### 示例

~~~~rmd-example
:: wavy 重要结论 | color=blue ::
~~~~

## `arrow` · 行内

手绘箭头（静态 SVG），支持文字和行内公式；颜色与笔触参数均可选。

正文必填。位置参数依次为 `color`，填写在具名参数前。

### 基本写法

将下面的占位内容替换为自己的文字。

~~~~text
:: arrow 正文 [| 参数] ::
~~~~

### 参数

| 参数 | 类型与取值 | 填写方式 | 默认值 |
| --- | --- | --- | --- |
| `color` | `color` · `red`、`orange`、`yellow`、`green`、`blue`、`purple`、`pink`、`cyan`、`teal` | 选填，可作第 1 个位置参数 | — |
| `stroke` | `sketch-stroke` · 0.5–6，最多两位小数 | 选填 | — |
| `padding` | `sketch-padding` · 0–24 CSS px，最多两位小数 | 选填 | — |
| `roughness` | `sketch-roughness` · 0–3，最多两位小数 | 选填 | — |

### 示例

~~~~rmd-example
:: arrow 重要结论 | color=blue ::
~~~~

## `badge` · 行内

状态标签；variant 未提供时界面使用中性变体。

正文必填。位置参数依次为 `variant`，填写在具名参数前。

### 基本写法

将下面的占位内容替换为自己的文字。

~~~~text
:: badge 正文 [| 参数] ::
~~~~

### 参数

| 参数 | 类型与取值 | 填写方式 | 默认值 |
| --- | --- | --- | --- |
| `variant` | `variant` · `neutral`、`info`、`success`、`warning`、`danger` | 选填，可作第 1 个位置参数 | `neutral` |

### 示例

~~~~rmd-example
:: badge 已完成 | success ::
~~~~

## `tooltip` · 行内

为行内内容提供悬停/聚焦说明。

正文必填。位置参数依次为 `description`，填写在具名参数前。

### 基本写法

将下面的占位内容替换为自己的文字。

~~~~text
:: tooltip 正文 [| 参数] ::
~~~~

### 参数

| 参数 | 类型与取值 | 填写方式 | 默认值 |
| --- | --- | --- | --- |
| `description` | `string` · 非空字符串；特殊字符可用 JSON 双引号和转义 | 选填，可作第 1 个位置参数 | — |

### 示例

~~~~rmd-example
:: tooltip Durable Objects | description="有状态计算" ::
~~~~

## `abbr` · 行内

缩写及其解释文本。

正文必填。位置参数依次为 `description`，填写在具名参数前。

### 基本写法

将下面的占位内容替换为自己的文字。

~~~~text
:: abbr 正文 [| 参数] ::
~~~~

### 参数

| 参数 | 类型与取值 | 填写方式 | 默认值 |
| --- | --- | --- | --- |
| `description` | `string` · 非空字符串；特殊字符可用 JSON 双引号和转义 | 选填，可作第 1 个位置参数 | — |

### 示例

~~~~rmd-example
:: abbr API | description="Application Programming Interface" ::
~~~~

## `kbd` · 行内

显示键盘按键名称。

正文必填。

### 基本写法

将下面的占位内容替换为自己的文字。

~~~~text
:: kbd 正文 [| 参数] ::
~~~~

### 参数

无具名参数。

### 示例

~~~~rmd-example
:: kbd Ctrl ::
~~~~

## `cloze` · 行内

显示需要用户主动揭示的填空项。

正文必填。位置参数依次为 `hint`，填写在具名参数前。

### 基本写法

将下面的占位内容替换为自己的文字。

~~~~text
:: cloze 正文 [| 参数] ::
~~~~

### 参数

| 参数 | 类型与取值 | 填写方式 | 默认值 |
| --- | --- | --- | --- |
| `hint` | `string` · 非空字符串；特殊字符可用 JSON 双引号和转义 | 选填，可作第 1 个位置参数 | — |

### 示例

~~~~rmd-example
:: cloze 欧姆定律 | hint="点击查看答案" ::
~~~~

## `note` · 多行块级

一般性笔记提示

标题选填。

### 基本写法

将下面的占位内容替换为自己的文字。

~~~~text
::: note [标题] [| 参数]

Markdown 正文

:::
~~~~

### 参数

| 参数 | 类型与取值 | 填写方式 | 默认值 |
| --- | --- | --- | --- |
| `id` | `id` · 字母开头、字母数字连字符、最长 80 字符（统一小写） | 选填 | — |

### 示例

~~~~rmd-example
::: note 笔记

这是一段示例正文。

:::
~~~~

## `info` · 多行块级

背景信息及解释

标题选填。

### 基本写法

将下面的占位内容替换为自己的文字。

~~~~text
::: info [标题] [| 参数]

Markdown 正文

:::
~~~~

### 参数

| 参数 | 类型与取值 | 填写方式 | 默认值 |
| --- | --- | --- | --- |
| `id` | `id` · 字母开头、字母数字连字符、最长 80 字符（统一小写） | 选填 | — |

### 示例

~~~~rmd-example
::: info 说明

这是一段示例正文。

:::
~~~~

## `tip` · 多行块级

推荐做法和经验

标题选填。

### 基本写法

将下面的占位内容替换为自己的文字。

~~~~text
::: tip [标题] [| 参数]

Markdown 正文

:::
~~~~

### 参数

| 参数 | 类型与取值 | 填写方式 | 默认值 |
| --- | --- | --- | --- |
| `id` | `id` · 字母开头、字母数字连字符、最长 80 字符（统一小写） | 选填 | — |

### 示例

~~~~rmd-example
::: tip 建议

这是一段示例正文。

:::
~~~~

## `success` · 多行块级

完成或成功状态

标题选填。

### 基本写法

将下面的占位内容替换为自己的文字。

~~~~text
::: success [标题] [| 参数]

Markdown 正文

:::
~~~~

### 参数

| 参数 | 类型与取值 | 填写方式 | 默认值 |
| --- | --- | --- | --- |
| `id` | `id` · 字母开头、字母数字连字符、最长 80 字符（统一小写） | 选填 | — |

### 示例

~~~~rmd-example
::: success 成功

这是一段示例正文。

:::
~~~~

## `warning` · 多行块级

需要注意或检查

标题选填。

### 基本写法

将下面的占位内容替换为自己的文字。

~~~~text
::: warning [标题] [| 参数]

Markdown 正文

:::
~~~~

### 参数

| 参数 | 类型与取值 | 填写方式 | 默认值 |
| --- | --- | --- | --- |
| `id` | `id` · 字母开头、字母数字连字符、最长 80 字符（统一小写） | 选填 | — |

### 示例

~~~~rmd-example
::: warning 警告

这是一段示例正文。

:::
~~~~

## `danger` · 多行块级

高风险或不可逆操作

标题选填。

### 基本写法

将下面的占位内容替换为自己的文字。

~~~~text
::: danger [标题] [| 参数]

Markdown 正文

:::
~~~~

### 参数

| 参数 | 类型与取值 | 填写方式 | 默认值 |
| --- | --- | --- | --- |
| `id` | `id` · 字母开头、字母数字连字符、最长 80 字符（统一小写） | 选填 | — |

### 示例

~~~~rmd-example
::: danger 危险

这是一段示例正文。

:::
~~~~

## `example` · 多行块级

独立示例内容

标题选填。

### 基本写法

将下面的占位内容替换为自己的文字。

~~~~text
::: example [标题] [| 参数]

Markdown 正文

:::
~~~~

### 参数

| 参数 | 类型与取值 | 填写方式 | 默认值 |
| --- | --- | --- | --- |
| `id` | `id` · 字母开头、字母数字连字符、最长 80 字符（统一小写） | 选填 | — |

### 示例

~~~~rmd-example
::: example 示例

这是一段示例正文。

:::
~~~~

## `question` · 多行块级

独立问答提示，不要求闪卡父容器

标题选填。

### 基本写法

将下面的占位内容替换为自己的文字。

~~~~text
::: question [标题] [| 参数]

Markdown 正文

:::
~~~~

### 参数

| 参数 | 类型与取值 | 填写方式 | 默认值 |
| --- | --- | --- | --- |
| `id` | `id` · 字母开头、字母数字连字符、最长 80 字符（统一小写） | 选填 | — |

### 示例

~~~~rmd-example
::: question 问题

这是一段示例正文。

:::
~~~~

## `mark` · 多行块级

块级黄色 Mark，可包含正文、公式。纯公式 Mark 宽度跟随公式。

标题留空。

### 基本写法

将下面的占位内容替换为自己的文字。

~~~~text
::: mark [| 参数]

Markdown 正文

:::
~~~~

### 参数

| 参数 | 类型与取值 | 填写方式 | 默认值 |
| --- | --- | --- | --- |
| `id` | `id` · 字母开头、字母数字连字符、最长 80 字符（统一小写） | 选填 | — |

### 示例

~~~~rmd-example
::: mark

$$
E=mc^2
$$

:::
~~~~

## `highlight` · 多行块级

手绘荧光笔（静态 SVG），支持正文、公式和其他块级内容；颜色与笔触参数均可选。

标题留空。位置参数依次为 `color`，填写在具名参数前。

### 基本写法

将下面的占位内容替换为自己的文字。

~~~~text
::: highlight [| 参数]

Markdown 正文

:::
~~~~

### 参数

| 参数 | 类型与取值 | 填写方式 | 默认值 |
| --- | --- | --- | --- |
| `color` | `color` · `red`、`orange`、`yellow`、`green`、`blue`、`purple`、`pink`、`cyan`、`teal` | 选填，可作第 1 个位置参数 | — |
| `stroke` | `sketch-stroke` · 0.5–6，最多两位小数 | 选填 | — |
| `padding` | `sketch-padding` · 0–24 CSS px，最多两位小数 | 选填 | — |
| `roughness` | `sketch-roughness` · 0–3，最多两位小数 | 选填 | — |
| `opacity` | `sketch-opacity` · 0.1–0.85，最多两位小数 | 选填 | — |
| `id` | `id` · 字母开头、字母数字连字符、最长 80 字符（统一小写） | 选填 | — |

默认使用黄色手绘荧光笔效果，颜色选填。

### 示例

~~~~rmd-example
::: highlight

$$
E=mc^2
$$

:::
~~~~

## `circle` · 多行块级

手绘圈选（静态 SVG），支持正文、公式和其他块级内容；颜色与笔触参数均可选。

标题留空。位置参数依次为 `color`，填写在具名参数前。

### 基本写法

将下面的占位内容替换为自己的文字。

~~~~text
::: circle [| 参数]

Markdown 正文

:::
~~~~

### 参数

| 参数 | 类型与取值 | 填写方式 | 默认值 |
| --- | --- | --- | --- |
| `color` | `color` · `red`、`orange`、`yellow`、`green`、`blue`、`purple`、`pink`、`cyan`、`teal` | 选填，可作第 1 个位置参数 | — |
| `stroke` | `sketch-stroke` · 0.5–6，最多两位小数 | 选填 | — |
| `padding` | `sketch-padding` · 0–24 CSS px，最多两位小数 | 选填 | — |
| `roughness` | `sketch-roughness` · 0–3，最多两位小数 | 选填 | — |
| `id` | `id` · 字母开头、字母数字连字符、最长 80 字符（统一小写） | 选填 | — |

### 示例

~~~~rmd-example
::: circle

$$
E=mc^2
$$

:::
~~~~

## `box` · 多行块级

手绘方框（静态 SVG），支持正文、公式和其他块级内容；颜色与笔触参数均可选。

标题留空。位置参数依次为 `color`，填写在具名参数前。

### 基本写法

将下面的占位内容替换为自己的文字。

~~~~text
::: box [| 参数]

Markdown 正文

:::
~~~~

### 参数

| 参数 | 类型与取值 | 填写方式 | 默认值 |
| --- | --- | --- | --- |
| `color` | `color` · `red`、`orange`、`yellow`、`green`、`blue`、`purple`、`pink`、`cyan`、`teal` | 选填，可作第 1 个位置参数 | — |
| `stroke` | `sketch-stroke` · 0.5–6，最多两位小数 | 选填 | — |
| `padding` | `sketch-padding` · 0–24 CSS px，最多两位小数 | 选填 | — |
| `roughness` | `sketch-roughness` · 0–3，最多两位小数 | 选填 | — |
| `id` | `id` · 字母开头、字母数字连字符、最长 80 字符（统一小写） | 选填 | — |

### 示例

~~~~rmd-example
::: box | color=orange

$$
E=mc^2
$$

:::
~~~~

## `bracket` · 多行块级

手绘括号（静态 SVG），支持正文、公式和其他块级内容；颜色与笔触参数均可选。

标题留空。位置参数依次为 `color`，填写在具名参数前。

### 基本写法

将下面的占位内容替换为自己的文字。

~~~~text
::: bracket [| 参数]

Markdown 正文

:::
~~~~

### 参数

| 参数 | 类型与取值 | 填写方式 | 默认值 |
| --- | --- | --- | --- |
| `color` | `color` · `red`、`orange`、`yellow`、`green`、`blue`、`purple`、`pink`、`cyan`、`teal` | 选填，可作第 1 个位置参数 | — |
| `stroke` | `sketch-stroke` · 0.5–6，最多两位小数 | 选填 | — |
| `padding` | `sketch-padding` · 0–24 CSS px，最多两位小数 | 选填 | — |
| `roughness` | `sketch-roughness` · 0–3，最多两位小数 | 选填 | — |
| `id` | `id` · 字母开头、字母数字连字符、最长 80 字符（统一小写） | 选填 | — |

### 示例

~~~~rmd-example
::: bracket

$$
E=mc^2
$$

:::
~~~~

## `underline` · 多行块级

手绘下划线（静态 SVG），支持正文、公式和其他块级内容；颜色与笔触参数均可选。

标题留空。位置参数依次为 `color`，填写在具名参数前。

### 基本写法

将下面的占位内容替换为自己的文字。

~~~~text
::: underline [| 参数]

Markdown 正文

:::
~~~~

### 参数

| 参数 | 类型与取值 | 填写方式 | 默认值 |
| --- | --- | --- | --- |
| `color` | `color` · `red`、`orange`、`yellow`、`green`、`blue`、`purple`、`pink`、`cyan`、`teal` | 选填，可作第 1 个位置参数 | — |
| `stroke` | `sketch-stroke` · 0.5–6，最多两位小数 | 选填 | — |
| `padding` | `sketch-padding` · 0–24 CSS px，最多两位小数 | 选填 | — |
| `roughness` | `sketch-roughness` · 0–3，最多两位小数 | 选填 | — |
| `id` | `id` · 字母开头、字母数字连字符、最长 80 字符（统一小写） | 选填 | — |

### 示例

~~~~rmd-example
::: underline

$$
E=mc^2
$$

:::
~~~~

## `double-underline` · 多行块级

双下划线（静态 SVG），支持正文、公式和其他块级内容；颜色与笔触参数均可选。

标题留空。位置参数依次为 `color`，填写在具名参数前。

### 基本写法

将下面的占位内容替换为自己的文字。

~~~~text
::: double-underline [| 参数]

Markdown 正文

:::
~~~~

### 参数

| 参数 | 类型与取值 | 填写方式 | 默认值 |
| --- | --- | --- | --- |
| `color` | `color` · `red`、`orange`、`yellow`、`green`、`blue`、`purple`、`pink`、`cyan`、`teal` | 选填，可作第 1 个位置参数 | — |
| `stroke` | `sketch-stroke` · 0.5–6，最多两位小数 | 选填 | — |
| `padding` | `sketch-padding` · 0–24 CSS px，最多两位小数 | 选填 | — |
| `roughness` | `sketch-roughness` · 0–3，最多两位小数 | 选填 | — |
| `id` | `id` · 字母开头、字母数字连字符、最长 80 字符（统一小写） | 选填 | — |

### 示例

~~~~rmd-example
::: double-underline

$$
E=mc^2
$$

:::
~~~~

## `details` · 多行块级

可折叠的正文容器，展开状态不产生版本。

标题选填。

### 基本写法

将下面的占位内容替换为自己的文字。

~~~~text
::: details [标题] [| 参数]

Markdown 正文

:::
~~~~

### 参数

| 参数 | 类型与取值 | 填写方式 | 默认值 |
| --- | --- | --- | --- |
| `id` | `id` · 字母开头、字母数字连字符、最长 80 字符（统一小写） | 选填 | — |

### 示例

~~~~rmd-example
::: details 展开说明

详细内容。

:::
~~~~

## `tabs` · 多行块级

选项卡容器，仅包含 tab 子容器。

标题选填。

### 基本写法

将下面的占位内容替换为自己的文字。

~~~~text
::: tabs [标题] [| 参数]

Markdown 正文

:::
~~~~

### 参数

| 参数 | 类型与取值 | 填写方式 | 默认值 |
| --- | --- | --- | --- |
| `id` | `id` · 字母开头、字母数字连字符、最长 80 字符（统一小写） | 选填 | — |

内部使用 `tab` 子容器。

### 示例

~~~~rmd-example
:::: tabs

::: tab 概览

第一项。

:::

::::
~~~~

## `tab` · 多行块级

单个选项卡，只能用于 tabs 内。

标题必填。

### 基本写法

将下面的占位内容替换为自己的文字。

~~~~text
::: tab 标题 [| 参数]

Markdown 正文

:::
~~~~

### 参数

无具名参数。

放置在 `tabs` 容器中。

### 示例

~~~~rmd-example
:::: tabs

::: tab 概览

正文。

:::

::::
~~~~

## `chat` · 多行块级

聊天会话容器，只允许 message 子容器。

标题选填。

### 基本写法

将下面的占位内容替换为自己的文字。

~~~~text
::: chat [标题] [| 参数]

Markdown 正文

:::
~~~~

### 参数

| 参数 | 类型与取值 | 填写方式 | 默认值 |
| --- | --- | --- | --- |
| `id` | `id` · 字母开头、字母数字连字符、最长 80 字符（统一小写） | 选填 | — |

内部使用 `message` 子容器。

### 示例

~~~~rmd-example
:::: chat 示例会话

::: message 用户 | sender=user

可以介绍一下这个组件吗？

:::

::: message Assistant | sender=assistant

可以。这是 **Astryx Chat** 消息布局。

:::

::::
~~~~

## `message` · 多行块级

消息，需要 chat 父容器，sender 是用户或 Agent 标签文本。

标题必填。

### 基本写法

将下面的占位内容替换为自己的文字。

~~~~text
::: message 标题 [| 参数]

Markdown 正文

:::
~~~~

### 参数

| 参数 | 类型与取值 | 填写方式 | 默认值 |
| --- | --- | --- | --- |
| `sender` | `string` · 非空字符串；特殊字符可用 JSON 双引号和转义 | 选填 | — |

放置在 `chat` 容器中。

### 示例

~~~~rmd-example
:::: chat

::: message Assistant | sender=assistant

好的。

:::

::::
~~~~

## `flashcard` · 多行块级

闪卡，严格包含 front 和 back，且顺序固定。

标题选填。

### 基本写法

将下面的占位内容替换为自己的文字。

~~~~text
::: flashcard [标题] [| 参数]

Markdown 正文

:::
~~~~

### 参数

| 参数 | 类型与取值 | 填写方式 | 默认值 |
| --- | --- | --- | --- |
| `id` | `id` · 字母开头、字母数字连字符、最长 80 字符（统一小写） | 选填 | — |

内部使用 `front`、`back` 子容器。

子容器按 `front` → `back` 顺序排列，每种各一组。

必须恰好包含一组 front、back，且按 front → back 排列。

### 示例

~~~~rmd-example
:::: flashcard

::: front

问题？

:::

::: back

答案。

:::

::::
~~~~

## `front` · 多行块级

闪卡正面，无标题。

标题留空。

### 基本写法

将下面的占位内容替换为自己的文字。

~~~~text
::: front [| 参数]

Markdown 正文

:::
~~~~

### 参数

无具名参数。

放置在 `flashcard` 容器中。

### 示例

~~~~rmd-example
:::: flashcard

::: front

问题？

:::

::: back

答案。

:::

::::
~~~~

## `back` · 多行块级

闪卡背面，无标题。

标题留空。

### 基本写法

将下面的占位内容替换为自己的文字。

~~~~text
::: back [| 参数]

Markdown 正文

:::
~~~~

### 参数

无具名参数。

放置在 `flashcard` 容器中。

### 示例

~~~~rmd-example
:::: flashcard

::: front

问题？

:::

::: back

答案。

:::

::::
~~~~

## `glossary` · 多行块级

术语表，只允许 definition 子容器。

标题选填。

### 基本写法

将下面的占位内容替换为自己的文字。

~~~~text
::: glossary [标题] [| 参数]

Markdown 正文

:::
~~~~

### 参数

| 参数 | 类型与取值 | 填写方式 | 默认值 |
| --- | --- | --- | --- |
| `id` | `id` · 字母开头、字母数字连字符、最长 80 字符（统一小写） | 选填 | — |

内部使用 `definition` 子容器。

### 示例

~~~~rmd-example
:::: glossary

::: definition 负载率

实际负载与额定容量的比例。

:::

::::
~~~~

## `definition` · 多行块级

术语定义，只能在 glossary 中出现。

标题必填。

### 基本写法

将下面的占位内容替换为自己的文字。

~~~~text
::: definition 标题 [| 参数]

Markdown 正文

:::
~~~~

### 参数

无具名参数。

放置在 `glossary` 容器中。

### 示例

~~~~rmd-example
:::: glossary

::: definition 负载率

实际负载与额定容量的比例。

:::

::::
~~~~

## `embed` · 独立单行块级

按文档 UUID 或绝对路径嵌入只读投影；支持 #anchor-id。

目标必填。

### 基本写法

将下面的占位内容替换为自己的文字。

~~~~text
::: embed 目标 [| 参数] :::
~~~~

### 参数

无具名参数。

目标填写 `id:UUID` 或完整虚拟路径，使用 `#anchor-id` 选择标题或段落。

### 示例

~~~~rmd-example
::: embed id:550e8400-e29b-41d4-a716-446655440000#chapter-one :::
~~~~

## `link-card` · 独立单行块级

将 HTTP(S) 页面显示为元信息卡片，不执行页面脚本。

目标必填。

### 基本写法

将下面的占位内容替换为自己的文字。

~~~~text
::: link-card 目标 [| 参数] :::
~~~~

### 参数

| 参数 | 类型与取值 | 填写方式 | 默认值 |
| --- | --- | --- | --- |
| `title` | `string` · 非空字符串；特殊字符可用 JSON 双引号和转义 | 选填 | — |

目标填写完整的 HTTP(S) 网址。

### 示例

~~~~rmd-example
::: link-card https://github.com/RavelloH/Recalloom | title=Recalloom :::
~~~~

## `@ attrs` 支持的 Markdown 对象

| 对象 | 可用属性 |
| --- | --- |
| 标题 | `id` |
| 段落 | `id` |
| 图片 | `id`、`width`、`height`、`caption` |
| 块级公式 | `id` |
| 表格 | `id`、`caption` |
| 代码块 | `id`、`file`、`wrap`、`expand` |

## `@ attrs` · 标题（`heading`）

为标题设稳定 ID。

属性选填。稳定 ID 可以写为首个位置参数 `@ attrs my-id @`，或使用具名参数 `id=my-id`，两种形式任选一种。

### 参数

| 参数 | 类型与取值 | 填写方式 | 默认值 |
| --- | --- | --- | --- |
| `id` | `id` · 字母开头、字母数字连字符、最长 80 字符（统一小写） | 选填 | — |

块编辑面板中的文本参数使用单行文字，最多 240 字符。

### 示例

~~~~rmd-example
## 研究方案 @ attrs chapter-one @
~~~~

## `@ attrs` · 段落（`paragraph`）

为段落设稳定 ID，不支持列表项 ID。

属性选填。稳定 ID 可以写为首个位置参数 `@ attrs my-id @`，或使用具名参数 `id=my-id`，两种形式任选一种。

### 参数

| 参数 | 类型与取值 | 填写方式 | 默认值 |
| --- | --- | --- | --- |
| `id` | `id` · 字母开头、字母数字连字符、最长 80 字符（统一小写） | 选填 | — |

块编辑面板中的文本参数使用单行文字，最多 240 字符。

### 示例

~~~~rmd-example
这一段可被引用。 @ attrs paragraph-one @
~~~~

## `@ attrs` · 图片（`image`）

图片的稳定 ID、宽高及说明文字。

属性选填。稳定 ID 可以写为首个位置参数 `@ attrs my-id @`，或使用具名参数 `id=my-id`，两种形式任选一种。

### 参数

| 参数 | 类型与取值 | 填写方式 | 默认值 |
| --- | --- | --- | --- |
| `id` | `id` · 字母开头、字母数字连字符、最长 80 字符（统一小写） | 选填 | — |
| `width` | `integer` · 40–1800 整数 | 选填 | — |
| `height` | `integer` · 40–1800 整数 | 选填 | — |
| `caption` | `string` · 非空字符串；特殊字符可用 JSON 双引号和转义 | 选填 | — |

在块编辑面板中设置 ID 时，使用 `fig-` 前缀。

块编辑面板中的文本参数使用单行文字，最多 240 字符。

### 示例

~~~~rmd-example
![实验装置](/examples/device.svg) @ attrs fig-device | width=480 | caption=实验装置 @
~~~~

## `@ attrs` · 块级公式（`math`）

数学公式锚点，仅适用于独立 $$ 数学块。

属性选填。稳定 ID 可以写为首个位置参数 `@ attrs my-id @`，或使用具名参数 `id=my-id`，两种形式任选一种。

### 参数

| 参数 | 类型与取值 | 填写方式 | 默认值 |
| --- | --- | --- | --- |
| `id` | `id` · 字母开头、字母数字连字符、最长 80 字符（统一小写） | 选填 | — |

在块编辑面板中设置 ID 时，使用 `eq-` 前缀。

块编辑面板中的文本参数使用单行文字，最多 240 字符。

### 示例

~~~~rmd-example
$$
P=UI
$$
@ attrs eq-power @
~~~~

## `@ attrs` · 表格（`table`）

表格稳定 ID 与图注；表格默认居中。

属性选填。稳定 ID 可以写为首个位置参数 `@ attrs my-id @`，或使用具名参数 `id=my-id`，两种形式任选一种。

### 参数

| 参数 | 类型与取值 | 填写方式 | 默认值 |
| --- | --- | --- | --- |
| `id` | `id` · 字母开头、字母数字连字符、最长 80 字符（统一小写） | 选填 | — |
| `caption` | `string` · 非空字符串；特殊字符可用 JSON 双引号和转义 | 选填 | — |

在块编辑面板中设置 ID 时，使用 `tbl-` 前缀。

块编辑面板中的文本参数使用单行文字，最多 240 字符。

### 示例

~~~~rmd-example
| 项目 | 数值 |
| --- | --- |
| 电压 | 220 |
@ attrs tbl-power | caption=测量数据 @
~~~~

## `@ attrs` · 代码块（`code`）

代码块 ID、文件名、换行与展开状态。

属性选填。稳定 ID 可以写为首个位置参数 `@ attrs my-id @`，或使用具名参数 `id=my-id`，两种形式任选一种。

### 参数

| 参数 | 类型与取值 | 填写方式 | 默认值 |
| --- | --- | --- | --- |
| `id` | `id` · 字母开头、字母数字连字符、最长 80 字符（统一小写） | 选填 | — |
| `file` | `string` · 非空字符串；特殊字符可用 JSON 双引号和转义 | 选填 | — |
| `wrap` | `boolean` · true / false | 选填 | — |
| `expand` | `boolean` · true / false | 选填 | — |

块编辑面板中的文本参数使用单行文字，最多 240 字符。

### 示例

~~~~rmd-example
~~~ts
const x = 1;
~~~
@ attrs code-example | file=example.ts | wrap=true | expand=false @
~~~~

## 参数填写与使用提示

- 属性值非空；使用空格包围的 ` | ` 分隔参数；位置参数必须先于具名参数。
- 普通值可不带引号，含分隔竖线等特殊字符使用 JSON 风格双引号及转义。
- 将 `@ attrs` 放在对应块的同行末尾，或紧贴整个块之后的独立行。
- 代码、公式、HTML 与链接 URL 中的伪语法不会被解释成 RMD 组件。
- 文稿名称、路径和标签在文稿信息中设置，权限通过授权管理。
- 默认值栏中的 — 表示此处没有指定默认值。
- 格式无效的内容按原文显示，可以检查组件名称、参数与闭合标记。
