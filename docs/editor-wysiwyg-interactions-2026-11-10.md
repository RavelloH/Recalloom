# Recalloom 可视化编辑器交互统一收尾（2026-11-10）

## 目标和分支

- 目标：正文所见即所得；块右侧把手 + 统一 Drawer；RMD 命令入口完整；右键操作与工具栏共享编辑命令。
- 起点：主线 `6cd2bb4`。在 `E:/Recalloom-editor-interactions` 新建 `feat/editor-wysiwyg-finish`（未直接改动主线）。
- 原工作树 `feat/editor-interaction-unification` 的 25 行未提交选区实验已以 `backup/editor-interactions-selection-20261110` 为名保存到 Git stash，另有 `E:/Recalloom/tmp/editor-interactions-uncommitted-20261110.patch` 文件备份。**该实验代码未叠加**：最新 main 已有真正接入菜单事件的选区快照逻辑。

## 已落地的交互

1. **可见文字直接修改**：原有正文、容器标题、代码文件名，新增 LinkCard 标题、图片 Figure 图注、表格 Table 图注的点击编辑，支持 Enter、Escape、失焦及键盘访问。图注编辑不触及表格 ProseMirror `contentDOM`，只在用户提交后通过单笔文档事务更新。
2. **块把手和嵌套**：沿用主线的合法嵌套子块定位、拖拽、上移/下移、复制、删除和约束校验。完整 RMD 源码仍可从把手操作中打开编辑。
3. **工具栏**：既有 RMD 行内命令 15/15，新增同一桌面 BubbleMenu / 移动固定工具栏的“更多行内功能”：Markdown 链接、行内数学公式、Wiki 引用、脚注引用、可见注释。点击菜单前保存 ProseMirror/DOM 选区，命令执行前恢复。
4. **斜杠菜单**：保留 RMD 块 25/25 + 叶子 2/2，新补普通 Markdown 的 H4/H5/H6 和 GFM 脚注定义。
5. **右键菜单**：在共享菜单命令中增加剪切/删除选中文字、撤销/重做；剪切等待剪贴板写入成功且原文未变化后才删除原选区。
6. **统一 Drawer**：桌面响应式网格把正文挤至左侧；移动全屏从底部进入，顶部固定预览；有效属性编辑实时写入当前文档草稿，但不自动提交到 D1。非法 RMD 草稿不覆盖原文。

## 验证

在 ASUS Windows 本地隔离 Wrangler + D1（8799、8815、8825、8826、8827），使用 Edge Headless，不接生产数据库：

- `pnpm check` 全部通过（MCP 帮助、图标、RMD 语法入口、TypeScript）。
- `pnpm test`：285/285 项通过，35 个测试套件。
- `pnpm build:web`：完成，仍有既有的大 Chunk 警告。
- `pnpm test:editor`：23/23 个浏览器 E2E 脚本通过；新增 `editor-direct-visible-text-e2e.mjs`、`editor-extra-inline-e2e.mjs` 已加入测试链，覆盖 1280/390px、Enter/Escape、预览、未保存不写 D1、RMD 源码往返；原有 `editor-rich-leaf-fields-e2e.mjs` 改为“点标题内联编辑，块把手打开 Drawer”，另扩展右键撤销/重做回归。
- 对话、嵌套块、代码、Wiki、复杂 RMD、属性编辑、320px 布局等现有 E2E 同样通过。

## 设计边界和后续验收

- 显示为外部网站元数据的摘要、站点名，以及 Wiki Embed 的外部只读投影，不属于本 Markdown 文档自身可编辑的文字；保留只读。
- 标签页选项卡标签的单击优先用于**切换选项卡**；实际子块标题可在容器内部点击编辑，或使用嵌套把手和统一 Drawer 修改。若将来需要“点击标签即重命名”，须明确如何避免与选项卡切换冲突。
- 公式、脚注标识、结构化引用等非自由文本仍使用已有属性编辑、弹窗或 Drawer；没有在可编辑正文内部嵌入会破坏 ProseMirror 文档的控件。
- 真实 iOS Safari / Android 触屏、横向公式及长页面滚动尚需设备级验收；本轮 E2E 为 Windows Edge Headless。
- 因长期性能研究仍在其他工作树，后续重新测量 50/100 KB 大文档完整挂载、键入 P95 和首屏 Chunk 体积；不要把本轮 UI 交互测试当成性能基线。

## 合并规则

必须在所有检查通过、检视远端 main 仍是预期祖先且没有并行冲突后，提交本分支并以正常 fast-forward/merge 方式合并和推送；不强推、不清理其它工作树。
