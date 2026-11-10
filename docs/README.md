# Recalloom 技术文档

本目录仅维护与当前产品实现相符、可长期更新的技术文档。项目介绍与部署入口位于 [README](../README.md)。

## 部署与开发

- [Cloudflare 部署与资源配置](deployment.md)
- [本地开发、测试和质量检查](development.md)
- [应用架构与模块边界](architecture.md)

## 编辑器与 RMD

- [Rich Markdown 实现和安全规范](rich-markdown.md)
- [RMD 1.0 可复制语法示例](rmd-1.0-syntax-showcase.md)
- [自动生成的完整 RMD 参数参考](rmd-syntax-reference.generated.md)

## 设计规范

- [CSS 设计变量与模块所有权](../web/src/styles/README.md)
- [语义图标与组件使用规范](../web/src/ICON_SYSTEM.md)

`src/help/` 是 MCP 帮助文档的权威来源，`src/rmd/registry.json` 是 RMD 组件参数的权威来源。对应生成文件通过命令更新，不要直接手改。

开发过程中的阶段计划、验收报告、临时实验和单项任务测试结果应留在本地被 Git 忽略的 `.agents/` 或 `docs/_local/`，不作为仓库文档发布。
