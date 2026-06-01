# Comparison Metrics Reference

本文档说明 UI 验收对比中使用的各项指标及其阈值。
**权威来源**：所有阈值以 [SKILL.md](../SKILL.md) 中定义的为准，本文档为补充说明。

## 1. 像素级整体对比（辅助参考）

**用途**：快速判断设计稿与实现的整体还原度，**不是**主要判定依据。

| RMSE | SSIM | 整体判定 |
|------|------|---------|
| < 0.05 | > 0.95 | 整体还原良好 |
| 0.05-0.15 | 0.85-0.95 | 有差异，需查看明细 |
| > 0.15 | < 0.85 | 明显偏差 |

**工具**：ImageMagick `compare -metric RMSE` / `compare -metric SSIM`

**局限性**：
- 对抗锯齿差异敏感
- 不理解语义等价（相同内容不同渲染）
- 不能替代精确数值对比

---

## 2. 六维度精确数值对比阈值

以下阈值与 SKILL.md 保持一致，基于"标准"验收严格度。

### 2.1 尺寸与位置

| 检查项 | 容差 | 判定 |
|--------|------|------|
| width/height | ±1px（关键）/ ±2px（非关键） | 超出为 FAIL |
| x/y 位置 | ±2px | 超出为 WARN |
| cornerRadius | ±1px | 超出为 FAIL |

### 2.2 颜色

将 Figma RGB + opacity 转换为 CSS 格式后对比：

| 检查项 | 容差 | 判定 |
|--------|------|------|
| 文字颜色 | Delta E < 2 | 超出为 FAIL |
| 背景颜色 | Delta E < 2 | 超出为 FAIL |
| 边框颜色 | Delta E < 3 | 超出为 WARN |
| 不同状态（hover/active/disabled） | Delta E < 3 | 需单独验证 |

> **Delta E 计算**：使用 CIEDE2000 公式（需 colormath 库）。
> Figma 返回 0-1 RGB，需乘 255 转为 0-255 后再计算。

### 2.3 字体排版

| 检查项 | 容差 | 判定 |
|--------|------|------|
| fontFamily | 完全匹配 | 不匹配为 FAIL |
| fontSize | ±1px | 超出为 FAIL |
| fontWeight | 完全匹配 | 不匹配为 FAIL |
| lineHeight | ±2px | 超出为 WARN |
| letterSpacing | ±0.5px | 超出为 WARN |
| textAlign | 完全匹配 | 不匹配为 FAIL |

### 2.4 间距与布局

| 检查项 | 容差 | 判定 |
|--------|------|------|
| padding (四方向) | ±1px（关键）/ ±2px（非关键） | 超出为 FAIL |
| margin | ±2px | 超出为 WARN |
| gap (flex/grid) | ±2px | 超出为 WARN |
| 对齐关系 | 左/右/居中一致 | 不一致为 FAIL |

### 2.5 视觉效果

| 检查项 | 容差 | 判定 |
|--------|------|------|
| box-shadow (color, offsetX, offsetY, blur, spread) | offset ±2px, blur ±3px, color ΔE < 3 | 超出为 WARN |
| opacity | ±0.05 | 超出为 WARN |
| border (width, style) | width ±1px | 超出为 WARN |
| gradient（如有） | 方向+色值一致 | 不一致为 WARN |

### 2.6 内容准确性

| 检查项 | 判定 |
|--------|------|
| 按钮文案 | 文本完全一致，不一致为 FAIL |
| 标题/正文 | 文本完全一致（允许空格/换行差异） |
| 占位符文本 | 一致为 OK |
| 图片/图标 | AI 截图比对确认内容正确 |
| 错别字/语法 | AI 文本分析检查 |

---

## 3. 验收严格度对应的容差调整

| 严格度 | 适用场景 | 尺寸容差 | 颜色容差 | 间距容差 |
|--------|---------|---------|---------|---------|
| 严格 | 关键页面/核心组件 | ±1px | Delta E < 1 | ±1px |
| 标准（默认） | 日常迭代 | ±1px(关键)/±2px(非关键) | Delta E < 2 | ±1px(关键)/±2px(非关键) |
| 宽松 | 概念验证/原型 | ±3px | Delta E < 5 | ±4px |

---

## 4. Diff 图解读

**diff 图中的颜色含义**（ImageMagick 默认配色）：
- **黑色像素**：完美匹配
- **红色像素**：实现中更亮
- **蓝色像素**：实现中更暗
- **黄色像素**：色相差异

**标注差异图（annotated-diff）**：
- 带有 ①②③ 编号标记的 diff 图
- 编号与验收报告问题清单中的编号一一对应
- 方便开发者快速定位问题位置

---

## 5. 常见误判处理

| 场景 | 原因 | 处理方式 |
|------|------|---------|
| 字体渲染差异 | 不同浏览器/OS 的抗锯齿 | 使用 Delta E 而非像素精确对比 |
| 动态内容（时间戳、用户名） | 内容不可预测 | 掩盖动态区域后再对比 |
| 滚动条差异 | 浏览器默认样式不同 | 截图时隐藏滚动条 |
| 微小亚像素偏差 | CSS 亚像素渲染 | 容差范围内自动忽略 |

---

## 6. Delta E 计算参考

```python
from colormath.color_objects import LabColor, sRGBColor
from colormath.color_diff import delta_e_cie2000
from colormath.color_conversions import convert_color

# Figma 返回 0-1 RGB → 转为 0-255 → 转 LAB → 计算 Delta E
def figma_color_to_delta_e(r1, g1, b1, r2, g2, b2):
    """r/g/b 均为 0-1 范围（Figma 原始值）"""
    lab1 = convert_color(sRGBColor(r1, g1, b1, is_upscaled=True), LabColor)
    lab2 = convert_color(sRGBColor(r2, g2, b2, is_upscaled=True), LabColor)
    return delta_e_cie2000(lab1, lab2)

# 安装：pip install colormath
# 如安装失败：pip install colormath numpy
```

---

**References**:
- [ImageMagick Compare Documentation](https://imagemagick.org/script/compare.php)
- [Delta E Color Difference (CIEDE2000)](https://en.wikipedia.org/wiki/Color_difference)
