# Astryx 组件使用与保留边界

本次审查以项目安装的 `@astryxdesign/core 0.7.4` 源码和公开类型为准。迁移保持原有字号、尺寸、配色和导航语义；组件来源统一不代表所有文档 DOM 都应改为通用应用控件。

## 已迁移

| 范围 | 当前实现 |
| --- | --- |
| 编辑器格式菜单 | `DropdownMenu` / `DropdownMenuItem`，保留鼠标悬停打开、正文选区和格式预览；点击、触屏及键盘使用库的菜单导航。 |
| 编辑器工具栏 | `Toolbar` 管理复合焦点，Tiptap 继续负责气泡位置和正文选区。 |
| Details 与闪卡 | `useCollapsible` + `IconButton`，可编辑标题与展开按钮互为兄弟；内容不卸载。闪卡正反面使用语法规定的固定标签。 |
| 只读提示与编辑器反馈 | `useTooltip` 保持行内 HTML；`useToast` / `ToastViewport` 保持右键菜单反馈的位置。 |
| 移动侧栏 | `MobileNav` 管理原生模态、Escape、背景隔离和焦点恢复；原生关闭事件之后重放真实路由链接，避免侧栏进入页面过渡快照。桌面仍使用 `SideNav`。 |
| 搜索、设置与版本对比 | `SegmentedControl` 提供互斥选择状态，设置使用导航模式 `TabList` / `Tab`；真实链接由公共 `LinkProvider` 接入 TanStack Router。 |
| 路径和文档信息 | `Breadcrumbs` / `BreadcrumbItem`、`MetadataList` / `MetadataListItem`；保留路径共享过渡、异步标签操作和窄屏列宽。 |
| 加载与空状态 | `Spinner`、`Skeleton`、`EmptyState`；保留加载公告、图谱画布与分批差异渲染。 |
| 块交互与展示 | 拖动把手使用 `IconButton`，代码标题和填空揭示使用 `Button`，快捷键使用 `Kbd`，文档摘要标签使用 `Token`。 |

填空的答案与触发按钮分离，答案可以包含可交互链接。只读状态展开后保留一个小的“隐藏”按钮；编辑状态的 ProseMirror `contentDOM` 始终挂载。

格式菜单的 hover 是应用对受控公开接口的适配，Astryx 没有独立的 hover 开关。安装版本只提供菜单入口动画，没有退出状态接口，因此不再保留旧的双菜单退出叠化；不为此重新复制一套菜单外壳。

搜索方式使用 `SegmentedControlItem` 直接子项，旁边常驻显示当前模式说明，不再为各选项重复挂载 Tooltip。说明以 React `useId` 加模式值生成稳定 ID，各 radio 的 `aria-describedby` 只关联自身说明：当前模式使用可见文字，其他模式使用隐藏文字。安装版本的 `SegmentedControl` 会用自身的禁用说明覆盖根节点传入的 `aria-describedby`，所以关联放在支持透传的选项上。此调整保留原有尺寸、间距和常驻说明，并减少路由切换时的额外弹层生命周期。

## 有意保留

| 实现 | 保留原因 |
| --- | --- |
| 首页、搜索卡片及知识库行的真实 TanStack `Link` | `ClickableCard` 的卡面是 `div`，仅有隐藏链接；整面右键、修饰键和 intent 预加载不能等价保留。库 `Table` 无公开 row href，`ListItem` 的链接也不覆盖整行。 |
| 导航行和知识库树 | 应用适配器已组合 Astryx `Button` / `IconButton` / `MoreMenu` 与真实链接；保留目录的受控持久展开、懒加载、快捷新建和现有布局。 |
| 标签编辑器 | 已组合 `Token`、`TextInput`、`Button`，保留显式添加、逐次异步提交、重复校验、失败恢复与忙状态；`Tokenizer` 的常驻搜索/创建模型不等价。 |
| 文档关联搜索 | 每条结果带明确“关联”按钮。`Typeahead` 选中会生成 token 并关闭候选，强换会增加确认步骤，或在 option 内嵌交互按钮。 |
| 文档标题原位编辑 | 直接编辑 `h1`，保留文件名、光标、提交/撤销和共享过渡；没有匹配的通用 InlineEdit API。 |
| 编辑态 NodeView Tooltip | 库会写入 anchor 的 `aria-describedby` / `popovertarget`；文档节点内的属性突变可能被 ProseMirror 接管。只读预览已使用库，编辑态保留无附加属性突变的专用提示。 |
| 属性注解装饰 | 非 React `Decoration.widget` 依赖事务位置映射和自身 DOM 生命周期；不为每个标记创建额外 React root。图片注解沿用同一文档外观。 |
| 滚动区 | 现有层负责 OverlayScrollbars 的按需加载、Apple WebKit 原生策略、真实 viewport ref、sticky 与路由滚动恢复。`useScrollableArea` 不替代这些约定，整体迁移需单独验证。 |
| 桌面堆叠面板与目录 | 面板高度排序、非模态正文占位、拖动关闭和跨编辑模式定位属于业务行为；手机已使用 `BottomSheet`。 |
| ContextMenu 定位兼容 | 已使用库；现有 transform/translate 适配保留，避免在未复现原定位问题时删除。 |
| OAuth 服务端授权页 | 独立静态 HTML POST 表单，需要无 JavaScript、严格 CSP、转义和拒绝按钮 `formnovalidate`。不为组件替换引入客户端水合或浏览器依赖。 |
| 图谱、代码、公式、差异与文档内容 DOM | 属于业务渲染或编辑器内核，不是另一套应用 UI。 |

Slash/wiki 补全保留 contenteditable 查询、键盘和虚拟光标位置；不能用以 `HTMLInputElement` 为输入源的 `Typeahead` 接管。浮层使用公开 `useLayer({mode:'fixed'})`，随编辑器滚动和尺寸变化更新坐标；编辑器通过 `aria-controls` / `aria-activedescendant` 关联当前 `listbox` 与候选项，焦点保持在正文。

## 后续约束

- 新的应用表单和动作使用 Astryx。`pnpm ui:check` 只保留两项文档属性注解原语例外，并会拒绝闲置例外。
- 优先使用公共 props、theme targets、语义元素及自有内容 class；不依赖匿名内部 `span`、SVG 的 style 字符串或组件私有布局。
- 迁移要同时验证桌面鼠标、键盘、390/320px 触屏、浅深色及 Chromium/WebKit。静态扫描不能代替焦点、选区、撤销和保存回归。
- 真实链接必须保留右键、修饰键、预加载及共享元素过渡；文档节点必须保留 ProseMirror 的挂载和事务所有权。

相关实现：[编辑器菜单](../web/src/visual-editor/inline-popup.tsx)、[移动侧栏](../web/src/shell.tsx)、[路由适配](../web/src/astryx-router-link.tsx)、[文档组合](../web/src/rmd-ui.tsx)、[UI 检查](../scripts/check-ui-controls.mjs)。
