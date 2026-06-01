# UI Acceptance Checker

**UI 验收自动化 Skill** — 对比 Figma 设计稿与实际实现，执行六维度精确数值对比，生成可直接交给开发修复的验收报告。

> 基于 [WorkBuddy](https://www.codebuddy.cn/docs/workbuddy/Overview) AI Agent 平台的 Skill，也可用于 Cursor / Claude Code / Codex 等平台。

---

## 效果预览

**输出报告样例**（深蓝渐变头部 + 问题标注图 + 精确定位信息）：

```
UI 验收报告
========================
实现网站：https://example.com
视口：1920px | 页面数：2
验收数据源：Figma API vs 浏览器 ComputedStyles

精确数值对比结果：
  检材-设备信息：颜色 1项 | 间距 3项 | 视觉 1项
  检材画像-微信：间距 2项

问题统计：P0=0 | P1=1 | P2=2 | P3=2（去重后合计 5 项）

P1 问题：
  ① Tab 栏左内边距不足
     定位: .tab-content [high] 上下文: .data-page
     设计: padding-left: 20px → 实现: 12px → 偏差 -8px
     修复: .tab-content { padding-left: 20px; }
```

报告输出为 `report-standalone.html`（图片 base64 内嵌，单文件可直接分享）。

---

## 核心能力

| 能力 | 说明 |
|------|------|
| **六维度精确对比** | 尺寸/颜色/字体/间距/视觉效果/内容，基于精确数值（px、Delta E），不是目测 |
| **跨页面问题去重** | 共享组件的重复问题自动提取为「跨页面共用问题」，避免冗余 |
| **精确元素定位** | 输出前端源码中 Ctrl+F 可搜索的 CSS 选择器（id > data-* > class > aria），带置信度标注 |
| **问题标注图** | 在截图上标注彩色编号框（P0 红/P1 橙/P2 黄/P3 蓝），开发一眼看到问题位置 |
| **独立 HTML 报告** | 图片 base64 内嵌，`report-standalone.html` 单文件分享，无需附带截图目录 |
| **多页面验收** | 支持一次提交多组 Figma + 实现 URL 配对，逐页验收 |

---

## 验收维度

| 维度 | 数据来源（Figma） | 数据来源（实现） | 对比方式 |
|------|-----------------|----------------|---------|
| 1. 尺寸与位置 | `absoluteBoundingBox` | `getBoundingClientRect()` | 数值差 |
| 2. 颜色 | `fills[].color` + `opacity` | `getComputedStyle().color/backgroundColor` | Delta E (CIEDE2000) |
| 3. 字体排版 | `style.fontFamily/fontSize/fontWeight/lineHeight` | `getComputedStyle()` | 数值差 |
| 4. 间距与布局 | `paddingLeft/Right/Top/Bottom`, `itemSpacing` | `getComputedStyle().padding/margin/gap` | 数值差 |
| 5. 视觉效果 | `effects[]` (shadow, blur), `strokes[]` | `getComputedStyle().boxShadow/filter` | 数值差 |
| 6. 内容准确性 | `characters` (text nodes) | DOM `textContent` | 文本对比 |

---

## 快速开始

### WorkBuddy 安装

将整个目录复制到 `~/.workbuddy/skills/ui-acceptance-checker/`：

```bash
# 克隆仓库
git clone https://github.com/your-username/ui-acceptance-checker.git

# 复制到 WorkBuddy skills 目录
cp -r ui-acceptance-checker ~/.workbuddy/skills/ui-acceptance-checker
```

重启 WorkBuddy，然后直接触发：

```
帮我做UI验收：
https://www.figma.com/design/xxx?node-id=1:2 | http://your-app.com/dashboard
```

### Cursor 使用

将 `SKILL.md` 内容复制到 `.cursor/rules/ui-acceptance-checker.mdc`：

```bash
mkdir -p .cursor/rules
cp SKILL.md .cursor/rules/ui-acceptance-checker.mdc
```

### Claude Code 使用

将 `SKILL.md` 内容追加到项目根目录的 `CLAUDE.md`：

```bash
cat SKILL.md >> CLAUDE.md
```

### Codex 使用

将 `SKILL.md` 内容追加到 `AGENTS.md`：

```bash
cat SKILL.md >> AGENTS.md
```

---

## 使用流程

1. **提供验收页面对**（Figma 链接 | 实现 URL）：

```
单页验收：
  https://www.figma.com/design/KEY?node-id=1:2 | https://example.com/dashboard

多页验收（每行一对）：
  https://www.figma.com/design/KEY?node-id=1:2 | https://example.com/dashboard
  https://www.figma.com/design/KEY?node-id=3:4 | https://example.com/settings
```

2. AI 验证 **Figma Token**（首次使用需提供，后续自动读取环境变量 `FIGMA_TOKEN`）

3. AI 打开实现页面 → **检查登录状态** → 截图 → 展示给你确认

4. 确认截图配对正确后，AI 执行 **六维度精确数值对比**

5. 生成 **`report-standalone.html`**（图片内嵌，可直接发给开发）

---

## 输出文件结构

```
ui-acceptance-reports/YYYY-MM-DD/
├── report-standalone.html          # ⭐ 主交付物（base64 内嵌，单文件可分享）
├── report.html                     # HTML 报告（需附带 screenshots/ 目录）
├── screenshots/
│   ├── design-{Frame}-1920.png     # Figma 设计稿截图
│   ├── impl-{Frame}-1920.png       # 实现页面截图
│   └── annotated-{Frame}-1920.png  # 问题标注图（彩色编号框）
├── design-data/
│   ├── {Frame}-full.json           # Figma 原始节点数据
│   └── {Frame}-tokens.json         # 提取的设计 Token 列表
└── comparison-details/
    └── {Frame}.json                # 六维度对比原始数据（存档用）
```

---

## 容差标准

| 严格度 | 适用场景 | 尺寸容差 | 颜色容差 | 间距容差 |
|--------|---------|---------|---------|---------|
| 严格 | 关键页面/核心组件 | ±1px | Delta E < 1 | ±1px |
| **标准（默认）** | 日常迭代 | ±1px(关键)/±2px(非关键) | Delta E < 2 | ±1px(关键)/±2px(非关键) |
| 宽松 | 概念验证/原型 | ±3px | Delta E < 5 | ±4px |

---

## 问题优先级

| 级别 | 颜色 | 定义 | 推荐操作 |
|------|------|------|---------|
| **P0** | 🔴 红 | 严重偏差，影响核心功能或品牌形象 | 立即修复，阻塞发布 |
| **P1** | 🟠 橙 | 明显偏差，影响视觉一致性 | 发布前必须修复 |
| **P2** | 🟡 黄 | 轻微偏差，细节不一致 | 建议修复 |
| **P3** | 🔵 蓝 | 微小差异，需视觉复核确认 | 可选优化项 |

---

## 前置条件

| 工具 | 用途 | 是否必需 |
|------|------|---------|
| Figma Personal Access Token | 提取设计数据 | **必需** |
| 本地浏览器（Chrome/Edge） | 截图 + Computed Styles | **必需** |
| ImageMagick | 像素级 diff 图（可选） | 可选 |
| Python / Node.js | 数据处理 | 必需 |

**获取 Figma Token**：Figma → Settings → Personal access tokens → Create new token（以 `figd_` 开头）

推荐配置为环境变量避免重复输入：
```bash
export FIGMA_TOKEN="figd_your-token-here"
```

---

## 文件说明

| 文件 | 说明 |
|------|------|
| `SKILL.md` | WorkBuddy Skill 主文件（AI 执行步骤、完整工作流） |
| `portable-ui-acceptance-checker.md` | 跨平台便携版（适用于 Cursor / Claude Code / Codex） |
| `references/report-template.md` | 验收报告内容结构模板 |
| `references/figma-api-setup.md` | Figma API 配置与常见端点指南 |
| `references/comparison-metrics.md` | 六维度对比指标与阈值详解 |
| `references/troubleshooting.md` | 常见问题排查指南 |
| `scripts/main.js` | Node.js 独立脚本（CI/CD 用，截图+像素对比） |
| `scripts/figma-screenshot.js` | Figma 设计稿截图模块 |
| `scripts/implementation-screenshot.js` | 实现页面截图模块 |
| `scripts/image-compare.js` | 图片对比模块（ImageMagick 封装） |

---

## 与其他 Skill 协作

| 场景 | 对应 Skill |
|------|-----------|
| 上线前做 UI 验收 | `ui-acceptance-checker`（本 Skill） |
| 评审设计稿交互和体验 | `design-review` |
| 生成设计规范文档 | `design-spec-generator` |
| 检查 Figma 文件规范（图层/组件/样式） | `design-file-audit` |

---

## 已知局限

- `elementFromPoint()` 只返回最顶层元素，被遮挡元素需先隐藏上层
- 选择器不保证全局唯一（confidence: medium/low 时需结合上下文）
- 无法自动验证动画/过渡效果
- 跨浏览器字体渲染差异可能影响数值比对
- Figma API 速率限制 100 次/分钟
- 动态内容（时间戳、登录用户名）需手动屏蔽或忽略

---

## License

MIT License — 自由使用、修改、分发。
