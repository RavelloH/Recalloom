# RMD 编辑器性能基线：2026-11-09

> **权威产品代码版本：** `24ee01d2070cd9cf384ae1f30ea30a5f5b99df21`（已推送 GitHub 的 `main`）。本次基线在这一代码版本之上采集；仅补充了可复现的性能测试脚本，不修改产品代码。

## 1. 测试环境与原则

- ASUS TUF F16，Intel Core i9-14900HX（32 逻辑线程），Windows；Node.js v24.8.0，pnpm 11.1.3。
- 浏览器：Microsoft Edge 157.0.4341.42，Headless Chromium，视口 1250 × 900。
- 地址：`127.0.0.1:8788`，独立 Wrangler 本地 D1：`tmp/rmd-performance-isolated`。**不连接生产数据库**。
- 原始数据：[rmd-editor-baseline-2026-11-09.json](./rmd-editor-baseline-2026-11-09.json)。其中含 **两轮 Node.js（每轮预热 + 七次采样）**和 **三轮 Edge（每个规模十二次键盘事件）**的所有测量值及源代码提交哈希。
- 数据分为 `attrs-*`（属性密集）和 `mixed-*`（真实 RMD 语法混合）两组。浏览器覆盖 **10 / 50 / 100 KB**，同时验证全部代码块实际挂载。
- 所有毫秒值都是相应运行中位数的中位值。浏览器的键盘到下一帧时间只是**输入响应代理指标，不是 Chrome INP / Event Timing**。

## 2. Node.js：RMD 词法、解析、序列化

不包括 DOM、React 和网络。每次测试运行独立进程、预热并显式 GC；表格为两轮中位数的中位值，单位 ms。

| 样本 | 字节 | Lexer | 可视化解析 | Markdown 序列化 |
| --- | ---: | ---: | ---: | ---: |
| 30 个属性块 | 1,848 | 6.86 | 6.45 | 0.07 |
| 180 个属性块 | 11,618 | 28.17 | 26.62 | 0.32 |
| 480 个属性块 | 31,718 | 62.97 | 65.02 | 0.70 |
| 混合 RMD 10 KB | 10,326 | 28.39 | 43.33 | 0.26 |
| 混合 RMD 50 KB | 51,464 | 270.14 | **441.26** | 2.06 |
| 混合 RMD 100 KB | 102,538 | 521.66 | **910.44** | 4.74 |

50 KB 两次独立运行的解析中位数为 **444.20 / 438.33 ms**；100 KB 为 **918.78 / 902.10 ms**，结果较一致。

## 3. Edge 浏览器：输入、初始化、视图切换

脚本同时记录：
- **容器出现**：从导航到 `.tiptap` 可见。
- **完整挂载**：从导航到样本所有 `.rk-code-block`（27 / 130 / 259 个）实际出现在文档，作为更可靠的就绪指标。
- **输入**：12 个 `x` 键，间隔 40 ms，采集 `keydown` 到下一个 `requestAnimationFrame` 的时间。
- **三视图**：切换到源码、预览，再返回可视化；返回可视化另行等待全部代码块。

| 测试文档 | 代码块数 | 可视化容器出现 | 可视化完整挂载 | 输入响应中位数 | 切源码 | 切预览 | 返回可视化完整挂载 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10 KB | 27 | 470 ms | **487 ms** | 77.8 ms* | 381 ms | 702 ms | 630 ms |
| 50 KB | 130 | 2,075 ms | **2,429 ms** | **17.6 ms** | 440 ms | 911 ms | 1,806 ms |
| 100 KB | 259 | 5,314 ms | **5,757 ms** | **32.7 ms** | 711 ms | 1,624 ms | 3,742 ms |

`* 10 KB` 的输入指标出现异常波动：三轮中位数为 **14.5 / 140.3 / 77.8 ms**，P95 分别为 **118.8 / 509.8 / 341.4 ms**。这一结果不适合直接用于判断性能回退或改善，应补充更多轮次并排查采样期间的系统活动。50 KB 三轮输入中位数为 **18.1 / 17.6 / 17.6 ms**；100 KB 为 **34.3 / 30.8 / 32.7 ms**，相对稳定。

50 KB 完整挂载三轮：**2,428.75 / 2,526.47 / 2,300.41 ms**。100 KB：**5,493.72 / 6,102.59 / 5,756.82 ms**。

## 4. 如何重新测量

在 ASUS 的 `E:/Recalloom` 检出目标版本、安装锁定依赖，并启动只监听本地地址的 Wrangler：

```powershell
pnpm install --frozen-lockfile
pnpm exec wrangler d1 migrations apply recalloom --local --persist-to ./tmp/rmd-performance-isolated
pnpm exec wrangler dev --ip 127.0.0.1 --port 8788 --local --persist-to ./tmp/rmd-performance-isolated
```

在另外的 PowerShell 终端中：

```powershell
$env:RMD_BASELINE_COMMIT=(git rev-parse HEAD).Trim()
node --expose-gc --import tsx scripts/rmd-performance-baseline.ts
node scripts/rmd-browser-performance-baseline.mjs
```

上述脚本输出到被 Git 忽略的 `tmp/`；应复制保存多轮数据，避免仅保留最后一次运行。**不要将 `.dev.vars`、登录密钥或本地 D1 数据库提交 Git。**

## 5. 对比和后续研究重点

1. **此基线替代旧的 `7bfca97` 基线作为后续回归参照**。旧测试存在不同程度的系统负载波动，且浏览器最初仅等待编辑器容器，并未确认完整文档挂载。旧数字和新数字不能直接等同于优化收益。
2. 未来优先评估 50/100 KB 的 **完整挂载时间**、输入帧延迟及 P95，而不是仅看容器出现。
3. 富组件文档包含大量 React NodeView，后续应通过同结构 A/B 对照分别量化 Badge、Callout 和代码块的挂载成本；不能因文档字节数相同就推断节点数量相同。
4. 保留三视图、Wiki/跨引用、Shiki 着色、RMD 语义、草稿恢复和 CAS 保存。不建议未经专项测试就实施全量 ProseMirror 虚拟化。
5. 使用 `pnpm check`、`pnpm test`、`pnpm build:web`、`pnpm test:editor` 及 `scripts/rmd-help-web-e2e.mjs` 进行功能回归；性能收益必须与正确性同时达标。

## 6. 测量限制

- 仅一台 ASUS、一个版本的 Edge。没有 CPU 节流、真实 iOS/Android 设备或跨机器比较。
- 完整挂载以代码块数量为准；公式、Mermaid、图片、网络元数据等异步资源的最终呈现并未独立计时。
- 源码与预览切换指标仅等待对应 DOM 容器；不代表全部异步组件渲染完毕。
- 输入时长受帧同步、系统调度、GC 和脚本自动化影响，不是函数本身的 CPU 耗时。
- 本文件是测量结果与方法的冻结快照，不表示任何特定优化将带来承诺的收益。
