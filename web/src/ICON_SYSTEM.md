# Recalloom 语义图标规范

统一入口：`web/src/icon.ts`。除该文件外，业务代码不得直接导入 `@tabler/icons-react`。Astryx 组件通过 `web/src/icon-theme.tsx` 获取同一语义图标，不额外改动 Astryx 自身的布局与交互。

## 使用

```tsx
import {Icon} from './icon';
<Icon name="document" size="md"/>
<Icon name="versionHistory" size="sm"/>
<Icon name="archive" size="sm"/>
<Icon name="taskList" inline/>
```

- `sm` = 16px：按钮、紧凑交互。
- `md` = 20px：导航、列表、文件树。
- `lg` = 24px：手机底栏、页面图标。
- `inline` = 1em：正文/标题中随文字缩放。覆盖 size，保持当前字体大小。
- 线宽统一由 Icon 组件维护（2）。不要给单个业务图标传宽高、线宽或独立 CSS 尺寸。
- `Icon` 根元素就是 SVG 本身，使用独立方格、`flex: none`，避免再次在 Astryx、TipTap 内插入 wrapper 破坏布局。

## 语义优先

- `activity`、`versionHistory`、`clock` 表示活动入口、历史版本和时间信息，不能混用。
- `archive` 与 `backup` 是不同操作，保留各自的图形。
- `taskList` 用于任务资源，`list` 等用于排版命令；具体名称以 `web/src/icon.ts` 的实际注册表为准。
- 活动条目使用 `created`、`updated`、`restore`、`trash`、`link`、`unlink` 等动作语义，避免所有条目使用历史图形。
- 对没有新增信息价值的属性标签或操作，不应重复添加装饰性图标。

## 布局与输入能力

侧栏操作统一使用 `NavRow`，链接和按钮共享 20px 图标槽、文本起点与尾部区域，不能依赖 Astryx Button 的内部 DOM 节点位置。交互仍遵循 CSS 体系的触控规范：通过 `(hover: hover) and (pointer: fine)` 判断鼠标悬停，不用屏幕宽度推断设备输入方式。

## 自动校验

- `pnpm icons:check`：检测直接 Tabler 导入、未知语义名称、重复视觉图形、禁用旧包装层、尺寸和线宽约束。
- `pnpm check`：包含前后端类型检查以及 CSS 所有权审计。
- `node scripts/run-editor-e2e.mjs icon-system-e2e.mjs css-layout-e2e.mjs editor-responsive-v5-e2e.mjs`：检查导航文字/图标对齐、文件树、底栏、编辑器、Callout 等。
- 新增功能图标时：先判断是否已有等义名称，避免通过减少或增加图标数量来代替语义设计。
