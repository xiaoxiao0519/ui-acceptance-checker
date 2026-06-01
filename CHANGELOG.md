# Changelog

All notable changes to this project will be documented in this file.

## [2.0.0] - 2026-06-01

### Added
- 跨页面问题去重：共享布局组件的重复问题自动提取为「跨页面共用问题」子章节
- 精确元素定位：输出 Ctrl+F 可搜索的 CSS 选择器（带置信度 high/medium/low）
- 问题标注图：P0 红色 / P1 橙色 / P2 黄色 / P3 蓝色编号框
- `report-standalone.html`：图片 base64 内嵌，单文件可直接分享
- 跨平台便携版（`portable-ui-acceptance-checker.md`）：支持 Cursor / Claude Code / Codex
- 报告头部统一为深蓝渐变风格，meta 信息用 grid 卡片展示

### Changed
- 默认报告格式从 Markdown 改为 HTML
- 报告禁止输出六维度全量数值表格，只输出有偏差的项
- 问题统计基于去重后的唯一问题数量

### Fixed
- 验收前强制验证 Figma Token 有效性，避免带着失效 Token 执行后续步骤
- 截图确认步骤必须获得用户明确同意才可继续，防止误配对

## [1.0.0] - 2026-05-01

### Added
- 初始版本
- 六维度精确数值对比（尺寸/颜色/字体/间距/视觉效果/内容）
- Figma REST API 直接调用（无需额外插件）
- 浏览器 Computed Styles 提取（基于 playwright-cli / agent-browser）
- 像素级截图对比（ImageMagick，可选）
- AI 视觉差异分析补充
- Markdown 格式验收报告
