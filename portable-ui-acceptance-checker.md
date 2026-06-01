# UI Acceptance Checker — Portable Version

> 这是跨平台便携版，可直接用于 Cursor / Claude Code / Codex 等 AI 编程工具。
> WorkBuddy 完整版请参考 `SKILL.md`。

---

对比 Figma 设计稿与实际实现，执行六维度精确数值对比，生成可直接交给开发修复的验收报告。

## 验收维度

| 维度 | 数据来源（Figma） | 数据来源（实现） | 对比方式 |
|------|-----------------|----------------|---------|
| 1. 尺寸与位置 | `absoluteBoundingBox` | `getBoundingClientRect()` | 数值差 |
| 2. 颜色 | `fills[].color` + `opacity` | `getComputedStyle().color/backgroundColor` | Delta E (CIEDE2000) |
| 3. 字体排版 | `style.fontFamily/fontSize/fontWeight/lineHeight` | `getComputedStyle()` | 数值差 |
| 4. 间距与布局 | `paddingLeft/Right/Top/Bottom`, `itemSpacing` | `getComputedStyle().padding/margin/gap` | 数值差 |
| 5. 视觉效果 | `effects[]` (shadow, blur), `strokes[]` | `getComputedStyle().boxShadow/filter` | 数值差 |
| 6. 内容准确性 | `characters` (text nodes) | DOM `textContent` | 文本对比 |

## 触发方式

- "检查UI验收" / "UI acceptance check"
- "对比设计稿和实现" / "compare design with implementation"
- "验证UI还原度" / "validate UI against Figma"
- 提供 Figma 链接 + 实现页面 URL

---

## 执行步骤

### Step 0: 参数确认与页面配对

**向用户确认**：
- **视口宽度**：默认 `1920`，可自定义
- **验收严格度**：严格(关键页面) / 标准(日常迭代) / 宽松(原型)，默认标准
- **验收维度**：默认全六维

**页面配对格式**：

```
单页验收：
  Figma链接 | 实现页面URL

多页验收（每行一对）：
  Figma链接1 | 实现URL1
  Figma链接2 | 实现URL2
```

#### 验证 Figma Token 有效性（必须）

1. 检查环境变量 `FIGMA_TOKEN` 或用户提供的 Token
2. 调用 `GET https://api.figma.com/v1/me` 验证：返回 200 有效，返回 401/403 则要求用户提供新 Token
3. Token 无效时立即停止，不进入后续步骤

#### 逐组登录验证 + 截图确认（必须）

对每组 Figma + 实现配对：
1. **打开实现页面 → 检查登录状态**：页面未登录时立即停止，向用户获取账号密码，登录后重新确认
2. **页面数据正常加载后截图**
3. **向用户同时展示设计截图 + 实现截图，获得明确确认后才继续**

### Step 1: 从 Figma 提取设计数据

#### 1.1 解析 Figma 链接

从 URL 提取 `fileKey` 和 `nodeId`：
- 格式：`https://www.figma.com/design/{fileKey}/...?node-id={nodeId}`
- `nodeId` 的 `-` 改为 `:` 后用于 API 请求

#### 1.2 调用 Figma REST API 获取节点数据

```
GET https://api.figma.com/v1/files/{fileKey}/nodes?ids={nodeId}
X-Figma-Token: {FIGMA_TOKEN}
```

#### 1.3 导出 Frame 截图

```
GET https://api.figma.com/v1/images/{fileKey}?ids={nodeId}&format=png&scale=2
X-Figma-Token: {FIGMA_TOKEN}
```

返回 S3 URL，下载到 `screenshots/design-{frame-name}-{viewport}.png`

#### 1.4 提取设计 Token

递归遍历节点树，提取颜色、字体、尺寸、间距、阴影等所有属性，构建 Token 对照表。

### Step 2: 浏览器截图 + 注册元素定位函数

> **浏览器必须以可见模式（headed）运行，窗口弹出并保持可见。严禁安装额外浏览器，使用系统已有的 Chrome/Edge。**

页面完全加载后截图：`screenshots/impl-{frame-name}-{viewport}.png`

在浏览器页面中注册以下元素定位函数（供 Step 4 调用）：

```javascript
function getElementAtPoint(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const cs = getComputedStyle(el);
  const rect = el.getBoundingClientRect();

  // 生成前端源码 Ctrl+F 可搜索的选择器
  // 优先级: id > data-* > 稳定 class（排除 hash） > role+aria > tagName
  function getLocatableSelector(el) {
    if (el.id) return { selector: '#' + CSS.escape(el.id), confidence: 'high' };
    for (const attr of ['data-testid', 'data-cy', 'data-qa']) {
      const val = el.getAttribute(attr);
      if (val) return { selector: `[${attr}="${CSS.escape(val)}"]`, confidence: 'high' };
    }
    if (el.className && typeof el.className === 'string') {
      const stableClasses = el.className.trim().split(/\s+/).filter(c =>
        c && !/^css-[a-z0-9]+$/i.test(c) && !/^sc-[a-z0-9]+$/i.test(c) && c.length < 50
      );
      if (stableClasses.length > 0)
        return { selector: '.' + CSS.escape(stableClasses[0]), confidence: 'medium' };
    }
    const role = el.getAttribute('role');
    const ariaLabel = el.getAttribute('aria-label');
    if (role && ariaLabel) return { selector: `[role="${role}"][aria-label="${CSS.escape(ariaLabel)}"]`, confidence: 'high' };
    if (role) return { selector: `[role="${role}"]`, confidence: 'medium' };
    return { selector: el.tagName.toLowerCase(), confidence: 'low' };
  }

  const selectorInfo = getLocatableSelector(el);

  return {
    selector: selectorInfo.selector,
    selectorConfidence: selectorInfo.confidence,
    tagName: el.tagName,
    width: Math.round(rect.width), height: Math.round(rect.height),
    x: Math.round(rect.x), y: Math.round(rect.y),
    borderRadius: cs.borderRadius,
    color: cs.color, backgroundColor: cs.backgroundColor, borderColor: cs.borderTopColor,
    fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight,
    lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing, textAlign: cs.textAlign,
    paddingTop: cs.paddingTop, paddingRight: cs.paddingRight,
    paddingBottom: cs.paddingBottom, paddingLeft: cs.paddingLeft,
    marginTop: cs.marginTop, marginBottom: cs.marginBottom, gap: cs.gap,
    boxShadow: cs.boxShadow, opacity: cs.opacity, filter: cs.filter,
    borderWidth: cs.borderTopWidth, borderStyle: cs.borderTopStyle,
    textContent: el.textContent?.trim().substring(0, 200)
  };
}
```

### Step 3: Figma 设计 Token 提取

从 Figma JSON 递归遍历节点树，构建结构化 Token 对照表，保存为 `design-data/{frame-name}-tokens.json`。

### Step 3.5: 像素级对比（可选）

如果 ImageMagick 可用，执行截图 RMSE + SSIM 对比，生成 diff 图供参考。可跳过，不影响 Step 4。

### Step 4: 六维度精确数值对比

对每个 Figma Token：
1. 通过 Token 的 `(x, y)` 坐标调用 `getElementAtPoint()` 定位 DOM 元素
2. 将 Figma 值和 ComputedStyle 值统一转换为可比较格式
3. 按容差标准逐项对比，超出容差记录到问题清单

**容差标准（标准严格度）**：
- 尺寸/间距：±1px（关键）/ ±2px（非关键）
- 颜色：Delta E < 2（CIEDE2000）
- 字体/字重/对齐：完全匹配

### Step 5: AI 视觉差异分析（补充）

AI 直接查看两张截图，补充发现数值对比可能遗漏的视觉问题（对齐方式、图标样式、Z 轴层级等）。

### Step 6: 生成标注图 + 验收报告

#### 6.1 生成问题标注图

在实现截图上绘制彩色编号框：P0 红色、P1 橙色、P2 黄色、P3 蓝色。
编号与问题清单严格对应。

#### 6.2 生成验收报告

**默认输出**：`report-standalone.html`（图片 base64 内嵌，单文件可直接分享）

**报告结构**：
1. 执行摘要 — 整体判定（PASS/REVIEW/FAIL）、问题统计、优先修复建议
2. 逐页验收 — **跨页面共用问题**（多页时）+ 每页：截图对比 + 问题标注图 + 页面特有问题清单
3. AI 视觉分析补充
4. 复测清单

**跨页面问题去重**：多页面验收时，同一 CSS 选择器 + 同一属性 + 同一偏差值 = 同一问题，提取为「跨页面共用问题」，各页面仅保留特有问题，统计基于去重后的数量。

**禁止输出六维度全量数值表格**，只输出有偏差的项。

**图片转 base64 内嵌（Python）**：
```python
import base64, os, re
report_dir = 'ui-acceptance-reports/YYYY-MM-DD'
html = open(f'{report_dir}/report.html', 'r', encoding='utf-8').read()
for rel_path in re.findall(r'src="(screenshots/[^"]+)"', html):
    full = os.path.join(report_dir, rel_path.replace('/', os.sep))
    if os.path.exists(full):
        b64 = base64.b64encode(open(full,'rb').read()).decode()
        ext = os.path.splitext(rel_path)[1].lower()
        mime = {'.png':'image/png','.jpg':'image/jpeg'}.get(ext,'image/png')
        html = html.replace(f'src="{rel_path}"', f'src="data:{mime};base64,{b64}"')
open(f'{report_dir}/report-standalone.html', 'w', encoding='utf-8').write(html)
```

### Step 7: 展示结果

向用户展示验收摘要和报告路径，说明主要问题和修复优先级。

---

## 容差标准

| 严格度 | 适用场景 | 尺寸容差 | 颜色容差 | 间距容差 |
|--------|---------|---------|---------|---------|
| 严格 | 关键页面/核心组件 | ±1px | Delta E < 1 | ±1px |
| **标准（默认）** | 日常迭代 | ±1px(关键)/±2px(非关键) | Delta E < 2 | ±1px(关键)/±2px(非关键) |
| 宽松 | 概念验证/原型 | ±3px | Delta E < 5 | ±4px |

---

## 平台部署指南

### Cursor
创建 `.cursor/rules/ui-acceptance-checker.mdc`，将本文件内容粘贴进去。

### Claude Code
将本文件内容追加到项目根目录的 `CLAUDE.md`。

### Codex
将本文件内容追加到 `AGENTS.md`。

### 通用
将本文件内容粘贴到任何支持 System Prompt / Custom Instructions 的 AI 工具中。

---

## 局限性

- `elementFromPoint()` 只返回最顶层元素，被遮挡元素需先隐藏上层
- 选择器不保证全局唯一（confidence: medium/low 时），需结合 ancestorContext 定位
- 无法自动验证动画/过渡效果
- Figma API 速率限制 100 次/分钟
- Cursor 无法直接控制浏览器，需用户手动截图并提供 DevTools Computed Styles
