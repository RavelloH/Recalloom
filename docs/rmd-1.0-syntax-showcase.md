# RMD 1.0 · 完整语法展示 @ attrs rmd-complete-guide @

这份文档可以直接复制到 Recalloom 的 Markdown 正文中。它采用真正的 RMD 1.0 语法，不是旧 Directive。请在**可视化 / 源码 / 预览**之间切换查看差异。图像使用内置的实际 SVG 示意图；示例 UUID 仅用于展示引用格式，在个人知识库中使用时请替换为真实目标。

## 01 · CommonMark、GFM 与数学 @ attrs section-standard @

**粗体**、*斜体*、~~删除线~~、<u>下划线</u>、行内代码 `pnpm check`、上标 <sup>2</sup> 和下标 <sub>2</sub>。

> 第一段引用。
>
> 第二段引用，仍可写 **重点**。

- 一级列表
  - 二级列表
- 另一个项目

1. 准备
2. 验证
3. 发布

- [x] 已完成
- [ ] 待检查

脚注[^rmd-source]可按 GFM 规范定义。

[^rmd-source]: 脚注正文也存储在 Markdown 内。

普通正文可以带稳定 ID。 @ attrs important-paragraph @

## 02 · Mark 与九色 Highlight @ attrs section-colors @

Mark 是独立语义标记，保持原有黄色视觉效果：:: mark 重要结论 ::。它并不等于“黄色 Highlight”。

- :: highlight 红色 | red ::
- :: highlight 橙色 | orange ::
- :: highlight 黄色 | yellow ::
- :: highlight 绿色 | green ::
- :: highlight 蓝色 | blue ::
- :: highlight 紫色 | purple ::
- :: highlight 粉色 | pink ::
- :: highlight 青色 | cyan ::
- :: highlight 蓝绿色 | teal ::

也能标记公式：:: mark $E=mc^2$ ::，或者指定具名参数：:: highlight 系统告警 | color=red ::。

::: mark

块级 Mark 包含普通正文与数学公式时，保持完整块背景：

$$
P=UI
$$

:::

下面是**仅包含公式**的块级 Mark：背景应恰好包裹公式，水平居中，而不是拉满正文宽度。

::: mark

$$
E=mc^2
$$
@ attrs eq-marked @

:::

::: highlight | color=blue

这是蓝色 Highlight，内部的 **Markdown** 仍正常。

:::

## 03 · 八种 Callout @ attrs section-callout @

::: note 笔记

暂时保存的知识点。

:::

::: info 说明

背景、术语与使用范围。

:::

::: tip 建议

可维护性的优化建议。

:::

::: success 成功

检查或任务已完成。

:::

::: warning 注意

发布前复核数据库迁移。

:::

::: danger 危险

重要风险或不可逆操作。

:::

::: example 示例

示例内部仍可以使用 **粗体** 和数学 $U=IR$。

:::

::: question 问题

不要求处于 Flashcard 内部的独立问题提示。

:::

嵌套时外层必须使用更长的冒号围栏：

:::: details 嵌套演示

这是外层 Details。

::: warning 内层提醒

这是内层 Callout。

:::

外层剩余文字。

::::

## 04 · 行内组件 @ attrs section-inline @

Badge 的全部变体：:: badge 普通 | neutral ::、:: badge 信息 | info ::、:: badge 完成 | success ::、:: badge 注意 | warning ::、:: badge 危险 | danger ::。

缩写：:: abbr API | description=Application Programming Interface ::。

提示：:: tooltip DO | description="Durable Objects | 有状态计算" ::。

快捷键：:: kbd Ctrl :: + :: kbd Shift :: + :: kbd P ::。

填空：:: cloze 电磁感应定律 | hint=点击显示答案 ::。

## 05 · 交互容器与学习组件 @ attrs section-learning @

::: details 详细说明

展开和收起不会改变正文或生成新修订。

:::

:::: tabs

::: tab 概览

选项卡 A 的内容可以包含 **普通 Markdown**。

:::

::: tab 参数

| 参数 | 数值 |
| :--- | ---: |
| R | 10 Ω |
| U | 220 V |

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

设备正常运行的标称电压。

:::

::: definition 负载率

实际负载与额定容量的比值。

:::

::::

:::: chat

::: message 用户 | sender=user

如何检查这段数据？

:::

::: message Assistant | sender=assistant

建议先核对实验记录，再提出审阅建议。

:::

::::

## 06 · 注释与 CriticMarkup @ attrs section-review @

行内注释：这一句 %%内部备注，不在预览显示%% 的其余部分可见。

%%
多行注释第一行。
多行注释第二行。
%%

增加建议：{++补充测量结论++}

删除建议：{--尚未确认的旧结论--}

替换建议：{~~旧方法~>新方法~~}

强调建议：{==需检查的数值==}

审阅批注：{>>人工核对记录<<}

可视化提供接受、拒绝与解决；只读预览保留尚未接受建议之前的已确认正文。批注不是 Agent 的自动执行授权。

## 07 · 图片、表格、代码与稳定 ID @ attrs section-attributes @

行内公式 $U=IR$，块级公式如下：

$$
P=UI=\frac{U^2}{R}
$$
@ attrs eq-power @

| 名称 | 单位 | 测量值 |
| :--- | :---: | ---: |
| 额定电压 | V | 400 |
| 额定功率 | kW | 220 |
@ attrs tbl-measurements | caption=设备参数表 @

下面使用项目自带的示意 SVG，不会出现失效图片占位：

![实验装置](/examples/device.svg "实验装置") @ attrs fig-device | width=480 | caption=实验装置接线示意 @

~~~typescript
interface Device {
  name: string;
  voltage: number;
}
const device: Device = {name: '电源', voltage: 400};
~~~
@ attrs code-device | file=src/device.ts | wrap=true | expand=false @

~~~mermaid
flowchart LR
 A[读取参数] --> B{有效?}
 B -->|是| C[计算]
 B -->|否| D[报错]
~~~

ID 以 ASCII 字母开头，最长 80 字符，规范化为小写。图片宽、高允许 40–1800 的整数；代码支持 `file`、`wrap`、`expand`。`@ attrs` 可以放在所在块同行尾部，或者紧邻其后的独立行。可视化编辑时，直接点击灰色斜体的 `@ attrs … @` 可以编辑 ID、图注、尺寸、文件名等属性；按 Enter 也能打开，填写后点「保存属性」，最后由整篇文档的「保存」提交修订。 无效参数会显示错误信息，不会自动改写正文。公式等居中的内容，其属性按钮也会居中。

## 08 · WikiLink、局部引用与只读嵌入 @ attrs section-wiki @

本文章节：[[#section-standard]]、[[#section-colors]]、[[#section-attributes]]。

本文段落：[[#important-paragraph]]。

图像 [[#fig-device]]、公式 [[#eq-power]]、表格 [[#tbl-measurements]]、代码 [[#code-device]]。图/公式/表自动编号，标题/段落/代码使用文字描述。

以下 UUID 是格式占位示例，并不保证存在对应记录：

[[id:550e8400-e29b-41d4-a716-446655440000|目标文档]]

[[id:550e8400-e29b-41d4-a716-446655440000#section-wiki|目标章节]]

::: embed id:550e8400-e29b-41d4-a716-446655440000 :::

::: embed id:550e8400-e29b-41d4-a716-446655440000#section-wiki :::

::: embed id:550e8400-e29b-41d4-a716-446655440000#important-paragraph :::

嵌入始终是只读投影，不会向目标记录写入修订。

GFM 表格中可使用带别名的 WikiLink，而不会额外拆列：

| 类别 | 文档 |
| :--- | :--- |
| 参数 | [[id:550e8400-e29b-41d4-a716-446655440000|参数说明]] |

## 09 · 链接卡片 @ attrs section-links @

::: link-card https://github.com/RavelloH/Recalloom | title=Recalloom 开源仓库 :::

标准链接依旧有效：[Recalloom](https://github.com/RavelloH/Recalloom "项目仓库")。

## 10 · 错误回退、安全与视图 @ attrs section-fallback @

以下围栏内的样本仅展示非法或已废弃的写法：

~~~text
==黄色高亮==                    不是 Mark
:badge[就绪]{variant=success}   旧版格式
:: badge | value=就绪 ::         主文本不能进入参数区
:: badge 完成 | unknown ::      不支持的变体
::: tab 孤立子容器              未满足父容器约束
::: embed 相对路径 :::           目标无效
@ attrs | width=wrong @         参数类型不合法
~~~

比较表达式 `a == b` 不是 Highlight。没有正确闭合或不符合 Schema 的扩展**回退纯文本**，不会部分提升成可执行组件。

可视化显示编辑态组件与弱化注释，源码显示原始字符，预览隐藏合法注释和合法属性装饰。三者共享草稿；只有明确保存才会持久化。HTML 被限制在安全子集，不能执行脚本；外部输入的 GitHub Alert、`<details>`、`<kbd>`、`<br/>` 可在安全条件下导入，但新写文档应使用 RMD 1.0。
