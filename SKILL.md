---
name: ui-acceptance-checker
description: |
  UI验收自动化 - 对比Figma设计稿与实际实现，生成可直接交给开发修复的验收报告。
  当用户需要验证实现是否符合设计规范、检查UI还原度、生成视觉回归测试报告时使用。
  触发场景：UI验收检查、设计稿还原度验证、视觉回归测试、像素级对比、
  设计一致性验证，或用户说"检查UI验收"、"对比设计稿"、"验证还原度"等。
  通过 Figma API 提取精确设计数据 + 浏览器 Computed Styles 提取实际渲染数据，
  执行六大维度数值对比，输出带精确修复建议的验收报告。
agent_created: true
allowed-tools: Read,Write,Edit,Bash,WebFetch,Skill
---

# UI Acceptance Checker - UI验收自动化

对比 Figma 设计稿与实际实现，执行六维度的精确数值对比，生成可直接交给开发修复的验收报告。

## 验收维度总览

基于 UI 验收标准，本工具覆盖以下六大维度：

| 维度 | 数据来源（Figma） | 数据来源（实现） | 比对方式 |
|------|------------------|-----------------|---------|
| 1. 尺寸与位置 | Figma Token: width, height, x, y, cornerRadius | getBoundingClientRect() | 数值差 |
| 2. 颜色 | Figma Token: fills (color, opacity) → #RRGGBB | getComputedStyle().color/backgroundColor → 解析为RGB | Delta E (CIEDE2000) |
| 3. 字体排版 | Figma Token: fontFamily, fontSize, fontWeight, lineHeight, letterSpacing | getComputedStyle() 对应属性 → 解析为数值 | 数值差 |
| 4. 间距与布局 | Figma Token: padding, gap, itemSpacing | getComputedStyle().padding/margin → 解析为数值 | 数值差 |
| 5. 视觉效果 | Figma Token: effects (shadow, blur), strokes → CSS box-shadow | getComputedStyle().boxShadow/filter | 数值差 |
| 6. 内容准确性 | Figma Token: text characters | 页面 DOM textContent | 文本对比 |

> **关键原则**：
> - 所有对比都基于**精确数值**（px、Delta E、数值差），不是截图目测
> - Figma API 返回的数据需要转换为可比较的格式（如 0-1 RGB × 255 → hex）
> - 浏览器 ComputedStyles 返回的是字符串（如 `"16px"`），需要解析为数值
> - 截图仅作为报告中的视觉参照附件，不参与判定

## 何时使用

- "检查UI验收" / "UI acceptance check"
- "对比设计稿和实现" / "compare design with implementation"
- "验证UI还原度" / "validate UI against Figma"
- "生成验收报告" / "generate acceptance report"
- 部署前验证设计保真度

## AI 执行步骤

以下步骤由 AI 按顺序执行，使用 WorkBuddy 内置工具完成。

### Step 0: 参数确认与页面配对

**向用户确认**（未提供的需询问）：
- **视口宽度**：默认 `1920`，可自定义
- **验收严格度**：严格(关键页面) / 标准(日常迭代) / 宽松(原型)，默认标准
- **验收维度**：默认全六维，用户可指定只检查某几项

**页面配对流程（核心：用户提供 Figma+实现 完整链接，AI 不做 URL 拼接）**：

#### 0.1 向用户展示输入规范

当用户发起验收请求但未提供完整信息时，先向用户展示以下规范：

```
请按以下格式提供验收页面（每组 = Figma设计链接 + 实现页面URL）：

单页验收：
  Figma链接 | 实现页面URL

多页验收（每组一行）：
  Figma链接1 | 实现URL1
  Figma链接2 | 实现URL2
  Figma链接3 | 实现URL3

示例：
  https://www.figma.com/design/xxx?node-id=15504-105557 | http://10.1.2.3/eeanalysisv3/#/portraits/data?collectId=xxx
  https://www.figma.com/design/xxx?node-id=20001-30001 | http://10.1.2.3/eeanalysisv3/#/dashboard
```

#### 0.2 验证 Figma Token 有效性（关键：不可跳过）

**⚠️ 在进入截图和验收流程之前，必须先确认 Figma Token 可用。Token 失效会导致后续所有 Figma API 调用失败，浪费大量时间。**

1. **检查 Token 来源**（按优先级）：
   - 环境变量 `FIGMA_TOKEN` 是否已设置
   - 上下文/记忆中是否记录了用户之前提供的 Token
   - 用户本次会话中是否已提供 Token
2. **如果未找到 Token**：
   - 向用户说明："需要 Figma Personal Access Token 才能提取设计数据。请在 Figma → Settings → Personal access tokens 中生成，粘贴给我（仅用于本次验收，不会写入报告或日志）"
   - 等待用户提供 Token，记录到本次会话上下文
3. **验证 Token 有效性**：
   - 使用 Token 调用 Figma API `GET /v1/me`（获取当前用户信息）
   - 如果返回 200 且包含 `email` / `handle` 等用户信息 → Token 有效
   - 如果返回 401/403 → Token 无效或已过期
4. **如果 Token 无效或已过期**：
   - **立即停止所有后续步骤**
   - 向用户说明："当前 Figma Token 已失效（返回 401），请提供新的 Token"
   - 等待用户提供新 Token 后重新验证
   - 重复此过程直到 Token 验证通过
5. **Token 验证通过后**，才可进入 0.3

> **为什么必须在截图前验证 Token**：如果 Token 失效，后续 Step 1（Figma 数据提取）会全部失败。在最早阶段发现问题可以避免用户等待大量无效操作后才被告知 Token 不行。

#### 0.3 逐组登录验证 + 截图确认（关键：不可跳过）

**对于每组 Figma+实现 配对，必须逐组执行以下流程。顺序严格为：先登录 → 再截图 → 再确认。**

##### 0.3.1 打开实现页面 → 检查登录状态（必须在截图之前）

1. **使用浏览器打开用户提供的完整实现 URL**（禁止 AI 自行拼接 URL）
   - **⚠️ 浏览器必须以可见模式（headed）启动，窗口必须弹出并保持可见**
   - `playwright-cli` 启动时**不传 `--headless` 参数**（默认即为有头模式）
   - 使用 `agent-browser` 时，**不要使用 headless 配置**，确保浏览器窗口可见
   - **禁止后台静默运行浏览器**：用户需要实时看到页面状态、登录过程、数据加载情况
2. 等待页面加载完成（`networkidle` + `document.fonts.ready`）
3. **检查页面是否处于未登录状态**，检测以下信号（任一出现即为未登录）：
   - 登录弹窗/模态框（包含"登录"、"账号"、"密码"、"请登录"、"登录已失效"等关键词的 `ant-modal`、`dialog`、`.login-*` 等）
   - 页面重定向到登录页（URL 变为 `/login`、`/signin` 等）
   - 页面主内容区为空白，仅有登录表单
   - 页面显示 401/403 错误
   - 页面主内容区显示"暂无数据"但存在登录相关 UI 元素
4. **如果检测到未登录状态**：
   - **立即停止所有后续步骤**，不截图、不提取数据、不继续下一组
   - 向用户说明："实现页面需要登录才能访问，请提供账号和密码（仅用于本次验收，不会写入任何报告或日志）"
   - 如登录页与目标 URL 不同，一并询问登录页 URL
   - 等待用户提供账号密码
   - 使用提供的账号密码执行登录操作（填写表单 → 点击登录按钮）
   - 登录后等待页面跳转/刷新完成，重新导航到目标 URL
   - **再次检查页面是否正常加载**（数据是否展示、无异常弹窗）
   - 如果登录失败或仍有异常，再次告知用户并等待进一步指示
5. **页面正常加载（已登录状态）后**，才可进入 0.3.2

##### 0.3.2 截图（登录确认后）

**⚠️ 只有在 0.3.1 确认页面已登录且数据正常加载后，才执行截图。**

1. **提取 Figma 设计稿截图**：通过 Figma REST API `GET /v1/images/{fileKey}?ids={nodeId}&format=png&scale=2` 获取 S3 URL，再下载到本地
2. **对实现页面截图**：页面完全加载后截图保存

##### 0.3.3 向用户展示并确认（必须获得明确同意）

**⚠️ 截图完成后必须展示给用户确认，未获得用户明确同意前绝对不得继续执行验收。**

1. 同时展示 Figma 设计截图和实现页面截图
2. 明确询问用户："请确认：左图是 Figma 设计稿「[Frame名称]」，右图是实现页面「[URL]」。**这两张图展示的是您要验收的同一个页面吗？**"
3. **等待用户明确回复**：
   - 用户确认"是的"/"匹配"/"没问题" → 记录配对确认通过，继续下一组或开始验收
   - 用户说"不匹配"或指出问题 → 询问正确的实现 URL 或正确的 Figma Frame，重新从 0.3.1 开始
   - 用户未明确回复 → **不得继续**，再次询问直到获得明确确认
4. **用户确认后的含义**：用户确认设计稿和实现截图展示的是同一页面/同一功能区域，后续六维度对比基于此确认进行

> **为什么登录检查必须在截图之前**：如果实现页面显示的是登录弹窗覆盖全屏，截图展示给用户的是登录界面而非目标页面。用户可能仅凭 URL 判断"匹配"，但实际内容完全不同。后续的 ComputedStyles 提取也全是登录弹窗的无效数据，导致验收结果毫无意义。
>
> **为什么必须让用户确认截图**：URL 可能指向正确但页面内容因权限/数据/环境等原因与设计稿不对应。只有用户亲眼确认"截图中的页面就是我想要验收的页面"，后续对比才有意义。

#### 0.4 全部确认后开始验收

所有页面配对确认完成后，才开始 Step 1（提取 Figma 设计数据）和后续验收流程。

**依赖检查**：
1. Figma REST API — 直接调用 `api.figma.com`（AI 通过 `curl` / `WebFetch` 请求，不依赖 figma skill 封装命令）
2. `playwright-cli` skill 或 `agent-browser` skill — 浏览器截图 + Computed Styles 提取
   - **⚠️ 禁止额外安装浏览器**：必须使用用户本地的 Chrome/Edge 等默认浏览器，严禁执行 `playwright install`、`npx playwright install chromium` 等下载浏览器的命令
   - 通过 `--channel chrome`（或 `--channel msedge`）指定系统浏览器
   - **⚠️ 浏览器必须始终以可见模式（headed）运行**：不传 `--headless` 参数，确保窗口弹出保持可见
3. `imagemagick` skill — 图片对比（辅助）
4. Figma Personal Access Token — 通过 Step 0.2 验证

> 如果依赖缺失，参考 [references/troubleshooting.md](references/troubleshooting.md)。

### Step 1: 从 Figma 提取设计数据

> **⚠️ 使用 Figma REST API 直接调用，不依赖 figma skill 的 `get-file` 等封装命令。**
> AI 直接通过 `curl` / `WebFetch` / HTTP 请求调用 Figma API，完全掌控数据格式和流程。

对每个 Frame，按以下流程提取：

#### 1.1 解析 Figma 链接

从用户提供的 Figma URL 提取 `fileKey` 和 `nodeId`：
- 格式：`https://www.figma.com/design/{fileKey}/...?node-id={nodeId}`
- `fileKey` = URL 中 `/design/` 后的第一段路径
- `nodeId` = `node-id` 参数值，格式如 `12088-16763`，需转为 `12088:16763`

#### 1.2 调用 Figma REST API 获取节点数据

**请求**：
```
GET https://api.figma.com/v1/files/{fileKey}/nodes?ids={nodeId}
Authorization: Bearer {FIGMA_TOKEN}
```

**返回值**：JSON 格式，包含 `nodes[{nodeId}].document` 节点树数据。

**保存原始数据**：`ui-acceptance-reports/{YYYY-MM-DD}/design-data/{frame-name}-full.json`

#### 1.3 导出 Frame 截图

**请求**：
```
GET https://api.figma.com/v1/images/{fileKey}?ids={nodeId}&format=png&scale=2
Authorization: Bearer {FIGMA_TOKEN}
```

**返回值**：`{ images: { "{nodeId}": "https://s3-alpha.figma.com/..." } }`

**下载截图**：使用 `curl` 或 Node.js 下载 S3 图片 URL 到本地：
- 保存路径：`screenshots/design-{frame-name}-{viewport}.png`

#### 1.4 从节点树中提取设计属性

从 Step 1.2 获取的 JSON 中递归遍历节点树，提取每个组件的以下属性：

| 属性 | Figma API 字段 | 说明 |
|------|---------------|------|
| 尺寸 | `absoluteBoundingBox.width/height` | 宽高 |
| 位置 | `absoluteBoundingBox.x/y` | X/Y 坐标 |
| 圆角 | `cornerRadius` | border-radius |
| 颜色 | `fills[].color` (r,g,b) + `opacity` | 文字/背景/边框色 |
| 字体族 | `style.fontFamily` | font-family |
| 字号 | `style.fontSize` | font-size |
| 字重 | `style.fontWeight` | font-weight |
| 行高 | `style.lineHeightPx` 或 `lineHeightPercent` | line-height |
| 字间距 | `style.letterSpacing` | letter-spacing |
| 对齐 | `style.textAlignHorizontal` | text-align |
| 内边距 | `paddingLeft/Right/Top/Bottom` | padding |
| 间距 | `itemSpacing`, `layoutMode` | gap |
| 阴影 | `effects[]` (type=DROP_SHADOW/INNER_SHADOW) | box-shadow |
| 描边 | `strokes[].color` + `strokeWeight` | border |
| 透明度 | `opacity` | opacity |

#### 1.5 文本内容提取

提取所有 Text 节点的 `characters` 字段，用于内容准确性比对。

#### 1.6 保存设计数据

- 原始节点数据：`design-data/{frame-name}-full.json`
- 提取的 Token 列表：`design-data/{frame-name}-tokens.json`

> **API 参考**：[references/figma-api-setup.md](references/figma-api-setup.md)

### Step 2: 浏览器登录 + 截图 + 准备元素定位工具

> **⚠️ 关键原则：登录态必须可用才能继续验收。如果页面出现登录失效/权限不足/无数据等情况，必须立即停止验收，向用户询问账号密码，登录成功并确认数据正常加载后再继续。绝不能在数据未加载的页面上硬做验收。**

> **浏览器使用策略（强制）**：
> - **⚠️ 浏览器必须始终以可见模式（headed）运行，窗口必须弹出并保持在前台可见**
> - **禁止后台静默运行**：用户需要实时看到页面加载、登录过程、数据加载等状态，以便确认操作是否正确执行
> - `playwright-cli` 启动时**不传 `--headless` 参数**（默认有头模式），通过 `--channel chrome` 或 `--channel msedge` 指定系统浏览器
> - `agent-browser` 时**不使用 headless 配置**，确保浏览器窗口可见
> - **必须使用用户本地默认浏览器**，严禁执行任何安装/下载浏览器的命令（如 `npx playwright install`、`playwright install chromium` 等）
> - 如果本地浏览器连接失败或被阻止，**向用户申请权限**（如"需要您允许浏览器自动化访问，是否同意？"），不要自行静默重试其他方案
> - 遇到弹窗拦截、安全警告等被阻止的情况，**立即向用户说明并申请权限**

对每个页面，使用 `playwright-cli` skill（备选 `agent-browser`）完成以下步骤：

#### 2.0 登录态二次检查（安全确认）

> **正常流程**：Step 0.3.1 已完成首次登录验证和用户截图确认。此处为安全兜底检查，
> 防止从 Step 0 到 Step 2 执行期间 Session 过期。

1. 设置视口（如 `agent-browser set viewport 1920 1080`）→ 重新导航到实现 URL
2. 等待页面加载完成（`networkidle` + `document.fonts.ready`）
3. **快速检查页面状态**：
   - 是否出现登录弹窗（"登录已失效"等）
   - 页面是否正常展示数据
4. **如果出现异常**（Session 过期等情况）：
   - 向用户说明："页面登录态已过期，请重新提供账号密码"
   - 重新登录后确认数据正常加载
   - 继续执行后续步骤
5. 页面正常则直接继续 Step 2.1

#### 2.1 截图

- 确认页面数据完全加载后截图
- 截图：`screenshots/impl-{frame-name}-{viewport}.png`
- **截图仅作为报告附件和视觉辅助，不是验收的主要依据**

#### 2.2 准备元素定位 JS 函数（后续 Step 4 使用）

> **核心思路**：不依赖预定义的选择器列表（不同项目写法差异大，硬编码无法覆盖），
> 而是通过截图差异定位问题位置，再用 `document.elementFromPoint()` 精确获取真实 DOM 元素及其选择器。
> 这与人工 F12 定位的流程一致：**先看图发现问题在哪 → 再去 F12 找具体元素**。
>
> **注意**：此步骤仅注册 JS 函数到浏览器上下文中，**不执行**具体查询。
> 实际的元素定位和属性提取在 Step 4 中进行，Step 4 会根据 Step 3 像素对比发现的差异坐标来调用此函数。

**在浏览器页面中注册以下函数**（`page.addScriptTag` 或 `page.evaluate`）：

```javascript
// 根据屏幕坐标精确定位 DOM 元素并提取完整信息
function getElementAtPoint(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;

  const cs = getComputedStyle(el);
  const rect = el.getBoundingClientRect();

  // 判断 class 是否为框架自动生成的 hash class（如 CSS Modules / Vue scoped / styled-components）
  function isHashClass(c) {
    // Hash class 特征：尾部有大小写混合或数字+字母混合的 4-8 字符随机串
    // 正常 class 后缀如 _submit、_hero、__title 是纯小写且语义化的，不会触发

    // CSS Modules: xxx_3aF2x / xxx_aB3c / btn_primary_3aF2x
    // 区别于 BEM: __submit(纯小写语义化) vs _3aF2x(大小写混合/数字)
    if (/[a-z]_[a-zA-Z0-9]{4,8}$/.test(c)) {
      // 进一步排除纯小写语义化后缀（如 _submit, __title, _dark, _hero）
      const suffix = c.match(/[a-z]_([a-zA-Z0-9]{4,8})$/)[1];
      if (/[A-Z]/.test(suffix) || /\d/.test(suffix)) return true;  // 大小写混合或含数字 = hash
      return false;
    }

    // styled-components / emotion: css-1a2b3c
    if (/^css-[a-z0-9]+$/i.test(c)) return true;

    // styled-components: sc-dxgOiQ
    if (/^sc-[a-z0-9]+$/i.test(c)) return true;

    // 下划线包裹: _active_8kP1m
    if (/^_[a-zA-Z]+_[a-zA-Z0-9]{4,}$/.test(c)) return true;

    return false;
  }

  // 生成源码中真实存在的选择器（不拼接合成路径）
  // 核心原则：输出前端代码里 Ctrl+F 能搜到的选择器片段
  function getLocatableSelector(el) {
    // 策略 1: id — 源码中一定存在
    if (el.id) return { type: 'id', selector: '#' + CSS.escape(el.id), confidence: 'high' };

    // 策略 2: data-* 属性 — 测试/工程属性，源码中一定存在
    for (const attr of ['data-testid', 'data-cy', 'data-qa', 'data-v-testid']) {
      const val = el.getAttribute(attr);
      if (val) return { type: 'data-attr', selector: `[${attr}="${CSS.escape(val)}"]`, confidence: 'high' };
    }

    // 策略 3: 稳定的 class（排除 hash class）— 取最短的前端可搜索片段
    if (el.className && typeof el.className === 'string') {
      const stableClasses = el.className.trim().split(/\s+/).filter(c => c && !isHashClass(c) && c.length < 50);
      if (stableClasses.length > 0) {
        // 只取第1个稳定 class，不加 tag 前缀，保持最短
        return { type: 'class', selector: '.' + CSS.escape(stableClasses[0]), confidence: 'medium' };
      }
    }

    // 策略 4: role + aria 属性 — 无障碍属性，源码中一定存在
    const role = el.getAttribute('role');
    const ariaLabel = el.getAttribute('aria-label');
    if (role && ariaLabel) return { type: 'aria', selector: `[role="${role}"][aria-label="${CSS.escape(ariaLabel)}"]`, confidence: 'high' };
    if (role) return { type: 'aria', selector: `[role="${role}"]`, confidence: 'medium' };

    // 策略 5: 回退到 tagName，标记 confidence 为 low
    return { type: 'tag', selector: el.tagName.toLowerCase(), confidence: 'low' };
  }

  // 向上查找最近的有 id/data-* 的祖先作为定位上下文
  function getAncestorContext(el) {
    let current = el.parentElement;
    while (current && current !== document.body) {
      if (current.id) return '#' + CSS.escape(current.id);
      for (const attr of ['data-testid', 'data-cy', 'data-qa']) {
        const val = current.getAttribute(attr);
        if (val) return `[${attr}="${CSS.escape(val)}"]`;
      }
      // 检查是否有稳定的 class（排除 hash）
      if (current.className && typeof current.className === 'string') {
        const stableClasses = current.className.trim().split(/\s+/).filter(c => c && !isHashClass(c) && c.length < 50);
        if (stableClasses.length > 0) return '.' + CSS.escape(stableClasses[0]);
      }
      current = current.parentElement;
    }
    return null;
  }

  const selectorInfo = getLocatableSelector(el);
  const ancestorCtx = getAncestorContext(el);

  return {
    // 源码可搜索的选择器
    selector: selectorInfo.selector,
    selectorConfidence: selectorInfo.confidence,  // high / medium / low
    ancestorContext: ancestorCtx,                  // 父级定位上下文（如有）
    tagName: el.tagName,
    className: el.className?.toString()?.substring(0, 200),

    // 尺寸与位置
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    borderRadius: cs.borderRadius,

    // 颜色
    color: cs.color,
    backgroundColor: cs.backgroundColor,
    borderColor: cs.borderTopColor,

    // 字体排版
    fontFamily: cs.fontFamily,
    fontSize: cs.fontSize,
    fontWeight: cs.fontWeight,
    lineHeight: cs.lineHeight,
    letterSpacing: cs.letterSpacing,
    textAlign: cs.textAlign,

    // 间距
    paddingTop: cs.paddingTop,
    paddingRight: cs.paddingRight,
    paddingBottom: cs.paddingBottom,
    paddingLeft: cs.paddingLeft,
    marginTop: cs.marginTop,
    marginRight: cs.marginRight,
    marginBottom: cs.marginBottom,
    marginLeft: cs.marginLeft,
    gap: cs.gap,

    // 视觉效果
    boxShadow: cs.boxShadow,
    opacity: cs.opacity,
    filter: cs.filter,

    // 描边
    borderWidth: cs.borderTopWidth,
    borderStyle: cs.borderTopStyle,

    // 文本内容
    textContent: el.textContent?.trim().substring(0, 200)
  };
}
```

> **选择器生成策略（核心原则：输出前端源码中 Ctrl+F 能搜到的选择器）**：
>
> **不生成合成路径**（如 `div > div.card:nth-of-type(2) > span > button`），因为这种路径在前端代码里不存在。
>
> | 优先级 | 策略 | 源码可搜 | 示例 |
> |--------|------|---------|------|
> | 1 | `id` | ✅ 一定可搜 | `#login-btn` |
> | 2 | `data-*` 属性 | ✅ 一定可搜 | `[data-testid="submit-btn"]` |
> | 3 | 稳定 class（排除 hash） | ✅ 可搜 | `.login-button` |
> | 4 | `role` + `aria-*` | ✅ 一定可搜 | `[role="button"][aria-label="提交"]` |
> | 5 | `tagName`（回退） | ⚠️ 太泛 | `button` |
>
> **附加信息**：
> - `selectorConfidence`：`high`（源码中唯一标识）/ `medium`（源码中有但可能不唯一）/ `low`（仅标签名，需结合其他信息定位）
> - `ancestorContext`：最近的有 id/data-*/稳定 class 的祖先选择器，用于缩小搜索范围
> - 报告中会组合输出：`选择器 [置信度] → 上下文: 父级选择器 → 文本: "按钮文字"`，前端同事可直接搜索定位

3. **保存截图路径**（实现数据在 Step 4 实时提取，无需预先批量保存）

### Step 3: Figma 设计Token提取（核心）

> **⚠️ 这是验收的核心数据来源。所有数值对比都以 Figma JSON 数据为准，截图仅作辅助参照。**

从 Step 1 获取的 Figma JSON 中，系统提取所有关键设计属性，构建结构化的 Token 对照表：

**提取流程**：
1. 读取已保存的 `design-data/{frame-name}.json`
2. 递归遍历节点树，提取以下类别的属性：

| 属性类别 | Figma 字段 | 转换目标 |
|---------|-----------|---------|
| 颜色 | `fills[].color` (r,g,b) + `opacity` | CSS `#RRGGBB` / `rgba(r,g,b,a)` |
| 字体族 | `style.fontFamily` | CSS `font-family` |
| 字号 | `style.fontSize` | CSS `font-size` (px) |
| 字重 | `style.fontWeight` | CSS `font-weight` |
| 行高 | `style.lineHeightPx` / `lineHeightPercent` | CSS `line-height` (px) |
| 字间距 | `style.letterSpacing` | CSS `letter-spacing` (px) |
| 文本对齐 | `style.textAlignHorizontal` | CSS `text-align` |
| 尺寸 | `absoluteBoundingBox.width/height` | CSS `width/height` (px) |
| 位置 | `absoluteBoundingBox.x/y` | 用于定位对应元素 |
| 圆角 | `cornerRadius` | CSS `border-radius` (px) |
| 内边距 | `paddingLeft/Right/Top/Bottom` | CSS `padding` (px) |
| 间距 | `itemSpacing`, `layoutMode` | CSS `gap` (px) |
| 阴影 | `effects[]` (DROP_SHADOW/INNER_SHADOW) | CSS `box-shadow` |
| 描边 | `strokes[].color` + `strokeWeight` | CSS `border` |
| 透明度 | `opacity` | CSS `opacity` |
| 文本内容 | `characters` | DOM `textContent` |

3. **建立 Figma 元素 → 屏幕坐标的映射**：每个节点的 `absoluteBoundingBox` 记录了在设计稿中的位置，用于后续定位对应的 DOM 元素

4. **保存 Token 列表**：`design-data/{frame-name}-tokens.json`，格式：
```json
[
  {
    "figmaNodeId": "15504:105557",
    "name": "顶部栏标题",
    "type": "TEXT",
    "x": 100, "y": 20, "width": 300, "height": 32,
    "text": "张三丰的iPhone 17 promax检材画像",
    "color": "#FFFFFF",
    "fontSize": 18,
    "fontWeight": 600,
    "fontFamily": "PingFang SC",
    "lineHeight": 26,
    "letterSpacing": 0
  },
  {
    "figmaNodeId": "15504:105600",
    "name": "Tab - 全部数据",
    "type": "TEXT",
    "color": "#266DFF",
    "fontSize": 16,
    "fontWeight": 500,
    "text": "全部数据"
  }
]
```

### Step 3.5: 像素级对比（辅助，可选）

> 截图对比仅作为辅助参考，不作为验收的主要判定依据。如果 ImageMagick 未安装，直接跳过此步骤。

对每个页面配对，使用 `imagemagick` skill 执行截图对比（如可用）：

1. 对齐尺寸 → RMSE + SSIM 对比
2. 生成 diff 图：`screenshots/diff-{frame-name}-{viewport}.png`
3. AI 识别 diff 图中的差异区域，记录坐标用于 Step 4 的元素定位

| RMSE | SSIM | 整体判定 |
|------|------|---------|
| < 0.05 | > 0.95 | 整体还原良好 |
| 0.05-0.15 | 0.85-0.95 | 有差异，需查看明细 |
| > 0.15 | < 0.85 | 明显偏差 |

> **跳过条件**：ImageMagick 未安装时跳过，不影响后续步骤。即使像素对比结果良好，仍需执行 Step 4 的精确数值对比。

### Step 4: 六维度精确数值对比（核心）

> **⚠️ 这是验收的核心步骤。通过 Figma Token vs 浏览器 ComputedStyles 的精确数值对比，而非截图目测，来判定每个属性的还原度。**

**输入**：
- Step 3 提取的 Figma Token 列表（`design-data/{frame-name}-tokens.json`）
- Step 2.2 注册的 `getElementAtPoint()` 函数

**执行流程**：

1. **遍历 Figma Token 列表**：对每个 Token，通过其在设计稿中的坐标位置 `(x, y)`，使用 `getElementAtPoint()` 定位浏览器中对应的 DOM 元素
2. **获取 Computed Styles**：从 `getElementAtPoint()` 的返回值中提取对应的 CSS 属性值
3. **类型转换**：将 Figma 值和 CSS 值统一为可比较的数值格式：
   - Figma 颜色 `(r, g, b)` (0-1) × 255 → CSS `#RRGGBB` 或 `rgba()` → 计算 Delta E
   - CSS 颜色字符串 `rgb(r, g, b)` / `#hex` → 解析为 RGB 数组
   - CSS 尺寸 `"16px"` → 解析为数值 16
4. **容差判定**：按六维度容差标准逐项对比
5. **匹配验证**：通过文本内容交叉验证 Figma 节点与 DOM 元素是否为同一元素
6. **记录问题**：超出容差的项记录到问题清单

> **坐标对齐说明**：Figma 坐标以画布为原点，DOM 坐标以视口为原点。需要减去 Frame 在画布中的偏移量 `(frameX, frameY)` 后再映射。如果设计稿和实现截图的缩放比例不同（如 Figma 2x 导出 vs 实现 1x），还需除以缩放倍数。

#### 维度 1：尺寸与位置

| 检查项 | 容差 | 判定 |
|--------|------|------|
| width/height | ±1px（关键）/ ±2px（非关键） | 超出为 FAIL |
| x/y 位置 | ±2px | 超出为 WARN |
| cornerRadius | ±1px | 超出为 FAIL |

#### 维度 2：颜色

将 Figma RGB + opacity 转换为 CSS 格式后对比：

| 检查项 | 容差 | 判定 |
|--------|------|------|
| 文字颜色 | Delta E < 2 | 超出为 FAIL |
| 背景颜色 | Delta E < 2 | 超出为 FAIL |
| 边框颜色 | Delta E < 3 | 超出为 WARN |
| 不同状态（hover/active/disabled） | Delta E < 3 | 需单独验证 |

> **Delta E 计算**：使用 CIEDE2000 公式（需 colormath 库）。
> Figma 返回 0-1 RGB，需乘 255 转为 0-255 后再计算。

#### 维度 3：字体排版

| 检查项 | 容差 | 判定 |
|--------|------|------|
| fontFamily | 完全匹配 | 不匹配为 FAIL |
| fontSize | ±1px | 超出为 FAIL |
| fontWeight | 完全匹配 | 不匹配为 FAIL |
| lineHeight | ±2px | 超出为 WARN |
| letterSpacing | ±0.5px | 超出为 WARN |
| textAlign | 完全匹配 | 不匹配为 FAIL |

#### 维度 4：间距与布局

| 检查项 | 容差 | 判定 |
|--------|------|------|
| padding (四方向) | ±1px（关键）/ ±2px（非关键） | 超出为 FAIL |
| margin | ±2px | 超出为 WARN |
| gap (flex/grid) | ±2px | 超出为 WARN |
| 对齐关系 | 左/右/居中一致 | 不一致为 FAIL |

#### 维度 5：视觉效果

| 检查项 | 容差 | 判定 |
|--------|------|------|
| box-shadow (color, offsetX, offsetY, blur, spread) | offset ±2px, blur ±3px, color ΔE < 3 | 超出为 WARN |
| opacity | ±0.05 | 超出为 WARN |
| border (width, style) | width ±1px | 超出为 WARN |
| gradient（如有） | 方向+色值一致 | 不一致为 WARN |

#### 维度 6：内容准确性

| 检查项 | 判定 |
|--------|------|
| 按钮文案 | 文本完全一致，不一致为 FAIL |
| 标题/正文 | 文本完全一致（允许空格/换行差异） |
| 占位符文本 | 一致为 OK |
| 图片/图标 | AI 截图比对确认内容正确 |
| 错别字/语法 | AI 文本分析检查 |

### Step 5: AI 视觉差异分析（补充）

> 此步骤为补充性分析，用于发现精确数值对比可能遗漏的问题。**不能替代 Step 4 的数值对比作为验收判定依据。**

除了数值对比，AI 还会直接查看设计截图和实现截图，识别数值对比可能遗漏的问题：

1. 将设计截图 + 实现截图 + diff 图一起给 AI 查看
2. AI 逐区域分析，补充发现：
   - 元素对齐方式不对（如应该居中但靠左了）
   - 图标样式不匹配（线形 vs 面形）
   - 图片裁切/比例不对
   - Z 轴层级关系错误（如下拉菜单被遮挡）
   - 缺失的装饰元素/分隔线
   - 加载状态/空状态未实现

### Step 6: 生成标注图 + 验收报告

#### 6.1 生成问题标注图（必须）

> **标注图是报告的核心交付物，让前端一眼看到问题在哪。**

对每个页面，基于 Step 4 记录的问题清单中每个问题的坐标位置，在实现截图上生成标注图：

1. **使用 ImageMagick** 在实现截图上绘制标注：
   - 对每个问题位置画 **红色矩形框**（`stroke red`，线宽 3px）
   - 在框旁边标注 **问题编号**（①②③...，白色文字+黑色描边，便于在任何背景上阅读）
   - 不同优先级用不同颜色区分：**P0 红色**、**P1 橙色**、**P2 黄色**、**P3 蓝色**
2. **保存标注图**：`screenshots/annotated-{frame-name}-{viewport}.png`
3. 标注图中的编号必须与问题清单中的编号**严格一一对应**

**标注图生成命令示例**（ImageMagick）：
```bash
# 单个问题标注：红框 + 编号
convert impl-page.png \
  -stroke "#FF0000" -strokewidth 3 -fill none \
  -draw "rectangle 100,200 380,250" \
  -font Arial -pointsize 16 \
  -fill white -stroke black -strokewidth 2 \
  -annotate +95+195 "①" \
  annotated-page.png
```

> 如果 ImageMagick 未安装，使用 Node.js Canvas 或 Python PIL 生成标注图。
> 如果均不可用，在报告中用文字描述问题位置替代标注图。

#### 6.2 生成验收报告

**默认输出格式为 HTML**（`report.html`），样式参考当前版本。用户可要求 Markdown 格式（`acceptance-report.md`）。

**必须严格遵循** [references/report-template.md](references/report-template.md) 的**内容结构和章节顺序**生成报告，不得自行改动。HTML 版本的排版样式以当前已验证的版本为准，内容必须与模板一致。

**HTML 样式规范**（与 design-review 报告保持统一风格）：
- **头部**：深蓝渐变背景（`linear-gradient(135deg, #0F2961, #1A3F8A)`），白色文字，圆角 16px，meta 信息用 grid 卡片展示
- **字体**：`"PingFang SC", "PingFang-Medium", "PingFang-Regular", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
- **CSS 变量**：`--bg: #F7F8FA`, `--card: #FFFFFF`, `--border: #E5E6EB`, `--brand: #165DFF`, `--text-primary/secondary/tertiary`, `--pass/warn/fail`
- **禁止**使用 `font-weight` CSS 属性，字重通过 PingFang 字体族切换（`PingFang-Medium` = 500, `PingFang-Regular` = 400）
- **Section 卡片**：白色背景 + 1px border + 12px 圆角，与 design-review 一致
- **图片内嵌**：报告中所有图片必须转为 base64 data URI 内嵌（`data:image/png;base64,...`），生成 `report-standalone.html` 作为最终交付物。单独下载 HTML 文件即可查看完整报告，无需依赖 screenshots/ 目录。Python 转换代码：

```python
import base64, os, re
html = open('report.html', 'r', encoding='utf-8').read()
for rel_path in re.findall(r'src="(screenshots/[^"]+)"', html):
    full = os.path.join(report_dir, rel_path.replace('/', os.sep))
    if os.path.exists(full):
        b64 = base64.b64encode(open(full,'rb').read()).decode()
        ext = os.path.splitext(rel_path)[1].lower()
        mime = {'.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'}.get(ext,'image/png')
        html = html.replace(f'src="{rel_path}"', f'src="data:{mime};base64,{b64}"')
open('report-standalone.html','w',encoding='utf-8').write(html)
```

> **报告结构**：
> 1. 执行摘要 — 整体判定、问题统计、优先修复建议
> 2. 逐页验收 — 跨页面共用问题（多页时）+ 每页：截图对比 + **问题标注图** + **页面特有问题清单**
> 3. AI 视觉分析补充
> 4. 复测清单
>
> **禁止**：
> - 禁止输出"精确数值对比明细"（六维度全量数值表格）。大量数据对前端开发无意义，增加阅读负担
> - 只输出问题清单（仅包含有偏差的项），每个问题含定位、设计值、实际值、偏差、修复方案
> - 问题编号与标注图红框编号严格对应

**跨页面问题去重（多页验收时必须执行）**：

当验收多个页面时，共享布局组件（导航栏、侧边栏、Tab 栏、全局 Header/Footer 等）会导致同一问题在多个页面重复出现。**必须对问题清单进行去重**：

1. **判定规则**：两个及以上页面的同一 CSS 选择器 + 同一 CSS 属性 + 同一偏差值 → 视为同一问题
2. **提取共用问题**：将跨页面共用问题提取为独立子章节「跨页面共用问题」，标注影响的所有页面
3. **各页仅保留特有**：每个页面的「问题清单」仅保留该页面独有的问题
4. **无独立问题标注**：如果某页面所有问题均为跨页面共用，标注"本页无独立偏差，所有偏差均来自跨页面共用组件"
5. **标注图保持不变**：各页面的标注图仍保留所有问题位置的标注框，共用问题的编号与「跨页面共用问题」章节对应
6. **统计去重**：执行摘要和总览中的问题统计（P0-P3 数量）必须基于去重后的唯一问题数量

**截图与问题对应**：每个页面的问题清单必须与该页面的标注图一一对应，不能跨页混排。问题编号在页面内连续。

### Step 7: 展示结果

向用户展示验收摘要：

```
UI 验收报告
========================
实现网站：https://example.com
视口：1920px | 页面数：3
验收数据源：Figma API Token vs 浏览器 ComputedStyles

精确数值对比结果：
  Dashboard:  尺寸 OK | 颜色 2项偏差 | 字体 OK | 间距 1项偏差 | 视觉 OK | 内容 OK
  Settings:   尺寸 1项偏差 | 颜色 OK | 字体 1项偏差 | 间距 3项偏差 | 视觉 1项偏差 | 内容 OK
  Login:      尺寸 3项偏差 | 颜色 2项偏差 | 字体 OK | 间距 4项偏差 | 视觉 2项偏差 | 内容 1项偏差

问题统计：P0=3 | P1=5 | P2=4 | P3=2

Top 问题（P0/P1）：
  1. [P0] Login页 background-color（颜色）
     定位: .login-btn [high] 上下文: #login-form 文本: "登 录"
     设计: #2563EB → 实现: #3B82F6 → ΔE=3.2 → 修复: .login-btn { background: #2563EB; }
  2. [P0] Login页 padding-top（间距）
     定位: .login-btn [high] 上下文: #login-form 文本: "登 录"
     设计: 14px → 实现: 10px → 偏差 +4px → 修复: .login-btn { padding-top: 14px; }
  3. [P0] Settings页 width（尺寸）
     定位: .sidebar [high] 上下文: #settings-layout
     设计: 240px → 实现: 220px → 偏差 +20px → 修复: .sidebar { width: 240px; }
  4. [P1] Settings页 letter-spacing（字体）
     定位: .card-title [medium] 上下文: .settings-panel
     设计: 0.5px → 实现: 0px → 偏差 +0.5px → 修复: .card-title { letter-spacing: 0.5px; }
  5. [P1] Dashboard页 box-shadow（视觉）
     定位: [data-testid="stat-card"] [high]
     设计: 0 4px 6px rgba(0,0,0,0.1) → 实现: none → 修复: [data-testid="stat-card"] { box-shadow: 0 4px 6px rgba(0,0,0,0.1); }

报告：ui-acceptance-reports/YYYY-MM-DD/report-standalone.html（base64 内嵌，可单独下载）
截图：ui-acceptance-reports/YYYY-MM-DD/screenshots/
```

## 容差标准（基于验收严格度）

| 严格度 | 适用场景 | 尺寸容差 | 颜色容差 | 间距容差 |
|--------|---------|---------|---------|---------|
| 严格 | 关键页面/核心组件 | ±1px | Delta E < 1 | ±1px |
| 标准（默认） | 日常迭代 | ±1px(关键)/±2px(非关键) | Delta E < 2 | ±1px(关键)/±2px(非关键) |
| 宽松 | 概念验证/原型 | ±3px | Delta E < 5 | ±4px |

## 配置选项

### 视口宽度

```javascript
viewport: 1920  // 默认桌面端
viewport: 1440  // 笔记本
viewport: 375   // 移动端
```

### 验收维度开关

```javascript
checks: {
  dimension: true,       // 维度1: 尺寸与位置
  color: true,           // 维度2: 颜色
  typography: true,      // 维度3: 字体排版
  spacing: true,         // 维度4: 间距与布局
  visualEffect: true,    // 维度5: 视觉效果（阴影/模糊等）
  content: true,         // 维度6: 内容准确性
  pixelComparison: true, // 辅助: 像素级整体对比
  aiVisualAnalysis: true  // 补充: AI 视觉差异分析
}
```

## 输出结构

**AI Skill 工作流输出**（Step 0-6）：
```
ui-acceptance-reports/YYYY-MM-DD/
├── report.html                                   # 主验收报告（默认，HTML 格式）
├── screenshots/
│   ├── design-{FrameName}-{viewport}.png        # 设计稿截图
│   ├── impl-{FrameName}-{viewport}.png          # 实现截图
│   ├── annotated-{FrameName}-{viewport}.png     # ⭐ 问题标注图（红框+编号）
│   └── diff-{FrameName}-{viewport}.png          # 差异图（如有 ImageMagick）
├── design-data/
│   ├── {FrameName}-full.json                    # Figma 原始节点数据
│   └── {FrameName}-tokens.json                  # 提取的设计Token列表
└── comparison-details/
    └── {FrameName}.json                         # 六维度对比原始数据（仅存档，不写入报告）
```

> **可选 Markdown 版本**：用户要求时，额外输出 `acceptance-report.md`，内容结构同 `report-template.md`。

> **注意**：报告中必须包含截图（设计稿 vs 实现），截图通过 Markdown 图片语法嵌入报告。截图仅作辅助参照，精确数值对比（tokens vs ComputedStyles）才是验收的主要判定依据。

**独立脚本输出**（`scripts/main.js`，CI/CD 使用，仅截图+像素对比）：
```
ui-acceptance-reports/YYYY-MM-DD/
├── acceptance-report.md                    # 简化报告（RMSE/SSIM + 截图）
└── screenshots/
    ├── design-page-1-{viewport}.png        # 设计稿截图（使用序号命名）
    ├── impl-page-1-{viewport}.png          # 实现截图
    └── diff-page-1-{viewport}.png          # 差异图
```

## 局限性

### 验收前置条件
- **登录态（Step 0.3.1 强制检查）**：在截图确认之前，必须先打开实现页面检查登录状态。如果页面未登录，**必须立即停止**，向用户获取账号密码并完成登录。登录成功且页面数据正常加载后，才可截图并向用户展示确认。绝不能在登录弹窗遮挡的页面上截图、确认或执行验收。
- **用户截图确认（Step 0.3.3 强制确认）**：截图完成后必须展示给用户，获得用户明确确认"这是我要验收的页面"后才可继续。未获确认不得执行任何验收步骤。
- **Figma Token 有效性（Step 0.2 强制验证）**：在截图和验收流程之前，必须验证 Figma Token 是否有效（通过调用 `/v1/me` 接口）。Token 失效时必须立即停止，要求用户提供新 Token 并重新验证。绝不能带着失效 Token 进入后续步骤。
- **账号信息安全**：用户提供的账号密码仅用于本次验收，不得写入报告、日志或任何持久化文件。验收完成后不应保留凭证信息。

### 技术限制
- 元素定位依赖 `elementFromPoint()`，被遮挡元素（如被浮层盖住）会定位到上层元素而非目标元素
- `elementFromPoint()` 只能返回最顶层元素，如需检查被遮挡的下层元素需先隐藏遮挡物
- 选择器不保证在页面中全局唯一（`confidence: medium/low` 时），需结合 `ancestorContext` 和文本内容辅助定位
- 如果元素没有 id / data-* / 稳定 class / aria 属性，选择器回退到 tagName（`confidence: low`），定位依赖上下文信息
- 无法验证动画/过渡效果（时长、缓动曲线）
- 动态加载内容需等待完成后截图
- 跨浏览器字体渲染差异可能影响数值
- Figma API 速率限制（100 次/分钟）
- 交互逻辑（点击、状态切换）需手动验证，自动化仅覆盖静态视觉

## 与其他 Skill 协作

| 场景 | 协作 Skill |
|------|-----------|
| 获取 Figma 设计数据 + 截图 | Figma REST API 直接调用（`api.figma.com`） |
| 浏览器截图 + Computed Styles 提取 | `playwright-cli` 或 `agent-browser` skill |
| 图片对比 | `imagemagick` skill |
| 设计评审（主观质量评估） | `design-review` |
| 设计规范文档生成 | `design-spec-generator` |
| 设计文件规范检查 | `design-file-audit` |

## HTML 报告输出

> 验收完成后，同时输出 Markdown `.md` 和 HTML `.html` 两份文件。

**HTML 模板来源**：统一使用 `shared/report-html-css.md` 中定义的全部 CSS。生成时严格遵循该模板，**禁止**增删修改任何样式规则。

**关键约束**：
- ⚠️ CSS 中**禁止**使用 `font-weight` 属性，字重差异通过 `font-family` 切换实现
- 报告标题使用 emoji 图标前缀（参照 `shared/report-html-css.md` Emoji 规范表）
- 问题严重度使用 `.priority-p0` / `.priority-p1` / `.priority-p2` / `.priority-p3` 彩色文字标签
- 报告头部使用 `.report-header` 深蓝渐变卡片（含 `.verdict-row` 整体判定行 + `.meta-grid` 元信息网格）
- 问题清单使用 `.issue-list` + `.issue-fail` / `.issue-warn` 带底色的列表项
- 内容分区使用 `.page-section` 白色卡片

**追加样式**（嵌入在 `</style>` 前，以 `<!-- skill: ui-acceptance-checker extra -->` 标识）：

```css
<!-- skill: ui-acceptance-checker extra -->
/* 截图对比 */
.img-compare { display: flex; gap: 12px; margin-bottom: 20px; }
.img-compare .img-box {
  flex: 1; border-radius: 8px; overflow: hidden;
  border: 1px solid var(--border);
}
.img-compare .img-box img {
  width: 100%; display: block; cursor: pointer;
}
.img-compare .img-label {
  text-align: center; padding: 8px; font-size: 13px;
  background: var(--bg); color: var(--text-secondary);
}

/* 标注截图 */
.annotated-img {
  width: 100%; border-radius: 8px;
  border: 1px solid var(--border); margin-bottom: 8px;
}
.annotated-note {
  font-size: 12px; color: var(--text-tertiary); margin-bottom: 16px;
}

/* 设计值 vs 实际值双列对比 */
.comparison-cell-design { color: var(--brand); }
.comparison-cell-actual { color: var(--warn); }

/* 偏差标签 */
.diff-badge {
  display: inline-block;
  font-family: "PingFang-SC-Semibold", "PingFang SC", "PingFangSC-Regular", "Helvetica Neue", sans-serif;
  background: var(--warn-bg);
  color: var(--warn);
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 11px;
}

/* 验收通过标记 */
.pass-badge {
  display: inline-block;
  font-family: "PingFang-SC-Medium", "PingFang SC", "PingFangSC-Regular", "Helvetica Neue", sans-serif;
  background: var(--pass-bg);
  color: var(--pass);
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 11px;
}
```

**输出文件**：
| 文件 | 说明 |
|------|------|
| `UI验收报告-[页面名].md` | Markdown 原格式 |
| `UI验收报告-[页面名].html` | HTML 独立页面 |

## 独立脚本（可选）

`scripts/` 目录下提供了独立 Node.js 脚本（仅覆盖截图+像素对比，不含精确数值对比），可用于 CI/CD 快速回归。

```bash
# 安装 npm 依赖（playwright 包本身，不含浏览器）
npm install playwright
export FIGMA_TOKEN="figd_your-token"
# Windows: choco install imagemagick

# 执行时指定系统浏览器（不安装 Chromium）
node scripts/main.js \
  --browser chrome \
  --page "https://figma.com/file/KEY?node-id=1:2|https://example.com/dashboard" \
  --page "https://figma.com/file/KEY?node-id=3:4|https://example.com/settings" \
  --viewport 1440
```

> **注意**：独立脚本不会安装额外浏览器，使用系统已有的 Chrome 或 Edge。`npm install playwright` 只安装 Node.js 包（~10MB），不包含浏览器二进制文件。

> **注意**：独立脚本只做截图+像素对比。精确的六维度数值对比需通过 AI 执行 Step 1-6 的 Skill 工作流完成。

## References

| 主题 | 文件 |
|------|------|
| Figma API 配置与数据提取 | [references/figma-api-setup.md](references/figma-api-setup.md) |
| 对比指标详解与阈值 | [references/comparison-metrics.md](references/comparison-metrics.md) |
| 验收报告模板 | [references/report-template.md](references/report-template.md) |
| 故障排查 | [references/troubleshooting.md](references/troubleshooting.md) |
