# Troubleshooting Guide

Common issues and solutions when running UI acceptance checks.

---

## 1. Figma API Issues

### Error: `403 Forbidden`

**Cause**: Invalid or expired Figma personal access token.

**Fix**:
1. Go to Figma Settings → Personal access tokens
2. Delete old token, create new one
3. Update your environment variable:
   ```bash
   export FIGMA_TOKEN="figd_new-token-here"
   ```

**Verify**:
```bash
curl -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/me"
```

---

### Error: `404 Not Found`

**Cause**: Incorrect `file_key` or `node_id` extracted from URL.

**Fix**:
1. Double-check Figma URL format:
   ```
   https://www.figma.com/file/[FILE_KEY]/[NAME]?node-id=[NODE_ID]
   ```
2. Ensure `node-id` is URL-encoded (if copied manually)
3. Verify file is accessible (not in draft/private with restricted access)

**Debug**:
```bash
# Test file access
curl -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/files/$FILE_KEY"
```

---

### Error: `Rate limit exceeded`

**Cause**: Too many API requests (>100/minute for personal tokens).

**Fix**:
1. Add delay between requests:
   ```javascript
   await new Promise(resolve => setTimeout(resolve, 600));  // 600ms delay
   ```
2. Batch requests when possible (use `/images` endpoint for multiple nodes)
3. Cache API responses to avoid re-fetching

**Monitor rate limits**:
```bash
# Check response headers
curl -I -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/me"
# Look for: X-RateLimit-Remaining
```

---

### Issue: Exported image doesn't match viewport size

**Cause**: `scale` parameter not set correctly.

**Fix**:
Match export scale to your breakpoint:
```javascript
// For 1024px viewport, export at 2x scale
const exportUrl = `https://api.figma.com/v1/images/${fileKey}?ids=${nodeId}&format=png&scale=2`;
// Resulting image width: 2048px (1024 × 2)
```

**Viewport-to-scale mapping**:
| Viewport Width | Recommended Scale | Exported Width |
|----------------|-------------------|-----------------|
| 375px (mobile) | 2x | 750px |
| 1024px | 2x | 2048px |
| 1920px | 1x or 2x | 1920px or 3840px |

---

## 2. Playwright / Browser Automation Issues

### Error: `playwright: command not found`

**Cause**: Playwright not installed or not found in PATH.

**Fix**:
```bash
npx playwright install          # 安装浏览器
npx playwright --version        # 验证安装
```

**Alternative**: Use `agent-browser` skill as fallback.

---

### Issue: Screenshot doesn't capture full page

**Cause**: Default screenshot only captures viewport.

**Fix**:
```javascript
// Playwright API（推荐）
await page.screenshot({ fullPage: true, path: 'screenshot.png' });
```

Or via agent-browser:
```javascript
await page.screenshot({ fullPage: true, path: 'screenshot.png' });
```

---

### Issue: Fonts not loaded in screenshot

**Cause**: Screenshot taken before web fonts load.

**Fix**:
Add wait strategy:
```javascript
// Wait for fonts to load
await page.waitForLoadState('networkidle');
// Or wait for specific font
await page.waitForFunction(() => document.fonts.check('16px Inter'));
```

---

### Issue: Dynamic content (ads, popups) interfering with screenshot

**Cause**: Unpredictable UI elements in screenshot.

**Fix**:
1. **Hide dynamic elements** via CSS:
   ```javascript
   await page.addStyleTag({
     content: '.ad-banner, .popup { display: none !important; }'
   });
   ```
2. **Use cookie consent** to dismiss popups:
   ```javascript
   await page.click('button:has-text("Accept")');
   ```
3. **Wait for content to stabilize**:
   ```javascript
   await page.waitForTimeout(2000);  // 2s delay
   ```

---

## 3. Image Comparison Issues

### Error: `compare: command not found` (ImageMagick)

**Cause**: ImageMagick not installed.

**Fix**:
```bash
# macOS
brew install imagemagick

# Ubuntu/Debian
sudo apt-get install imagemagick

# Windows
choco install imagemagick
```

**Verify**:
```bash
compare -version
```

---

### Issue: Too many false positives (minor pixel diffs)

**Cause**: Anti-aliasing, font rendering diffs, sub-pixel variations.

**Fix**:
1. **Use perceptual comparison** (not pixel-exact):
   ```bash
   compare -metric RMSE -fuzz 5% design.png impl.png diff.png
   ```
   (`-fuzz 5%` ignores minor color variations)

2. **Apply Gaussian blur** before comparison:
   ```bash
   convert design.png -blur 0x1 design-blured.png
   convert impl.png -blur 0x1 impl-blured.png
   compare design-blured.png impl-blured.png diff.png
   ```

3. **Exclude regions** (e.g., dynamic text):
   ```javascript
   // In image-compare.js
   excludeRegions: [
     { x: 100, y: 50, width: 200, height: 30 },  // Timestamp area
   ]
   ```

---

### Issue: Diff image is all black (no differences detected)

**Cause**: Images not aligned (different dimensions or aspect ratio).

**Fix**:
1. **Resize images to same dimensions** before comparison:
   ```bash
   convert impl.png -resize 1024x768! impl-resized.png
   compare design.png impl-resized.png diff.png
   ```
2. **Check aspect ratio** of design vs implementation:
   ```javascript
   // Design aspect ratio
   const designAspect = designWidth / designHeight;
   // Implementation may have different height (scrollable content)
   ```

---

### Issue: Comparison score too low (< 70%) but visually looks fine

**Cause**: Color space differences (sRGB vs RGB), gamma correction.

**Fix**:
1. **Convert both images to sRGB** before comparison:
   ```bash
   convert design.png -colorspace sRGB design-srgb.png
   convert impl.png -colorspace sRGB impl-srgb.png
   compare design-srgb.png impl-srgb.png diff.png
   ```
2. **Use perceptual color metric** (Delta E):
   ```python
   # Use Python colormath for perceptual comparison
   # pip install colormath
   from colormath.color_diff import delta_e_cie2000
   ```

---

## 4. Report Generation Issues

### Issue: Report file not created

**Cause**: Output directory doesn't exist or permission denied.

**Fix**:
```bash
# Create output directory
mkdir -p ui-acceptance-reports/2026-05-20
# Check permissions
ls -la ui-acceptance-reports/
```

---

### Issue: Screenshots not embedded in report

**Cause**: Relative paths incorrect, or screenshots saved to wrong folder.

**Fix**:
1. Use **absolute paths** in report Markdown:
   ```markdown
   ![Design](/absolute/path/to/ui-acceptance-reports/2026-05-20/screenshots/design-1024.png)
   ```
2. Verify screenshot paths exist:
   ```bash
   ls ui-acceptance-reports/2026-05-20/screenshots/
   ```

---

## 5. Skill Invocation Issues

### Error: `Skill "ui-acceptance-checker" not found`

**Cause**: Skill not installed correctly.

**Fix**:
1. Verify skill exists in `~/.workbuddy/skills/`:
   ```bash
   ls ~/.workbuddy/skills/ui-acceptance-checker/
   ```
2. Check skill name in `SKILL.md` frontmatter:
   ```yaml
   name: ui-acceptance-checker  # Must match folder name
   ```
3. Restart WorkBuddy to reload skills.

---

### Issue: Skill runs but doesn't trigger browser automation

**Cause**: Playwright or `agent-browser` not available.

**Fix**:
1. Check available tools:
   ```bash
   npx playwright --version
   ```
2. Install missing dependencies:
   ```bash
   npm install playwright
   npx playwright install chromium
   ```

---

## 6. Performance Issues

### Issue: Skill takes too long to run (> 10 minutes)

**Cause**: Too many breakpoints, or waiting too long for page loads.

**Fix**:
1. **Reduce breakpoints** (test only critical ones):
   ```
   /ui-acceptance-checker --breakpoints 1024,1920
   ```
2. **Reduce screenshot delay**:
   ```javascript
   await page.waitForTimeout(1000);  // Reduce from 3000 to 1000
   ```
3. **Run parallel sub-agents** for multiple URLs:
   ```
   /ui-acceptance-checker --parallel
   ```

---

### Issue: Out of memory (OOM) when comparing large images

**Cause**: High-resolution images (4K+) consume too much RAM.

**Fix**:
1. **Resize images before comparison**:
   ```bash
   convert design.png -resize 1920x1080 design-resized.png
   convert impl.png -resize 1920x1080 impl-resized.png
   ```
2. **Use tiling** (compare in chunks):
   ```python
   # Split image into 512x512 tiles, compare tile-by-tile
   ```

---

## 7. Getting Help

**If none of the above fixes work**:

1. **Collect debug info**:
   - Skill version (`SKILL.md` → `version:` field)
   - Error message (full stack trace)
   - Environment (OS, Node.js version, Python version)
   - Screenshots of the issue

2. **Check skill logs**:
   ```bash
   cat ~/.workbuddy/logs/ui-acceptance-checker.log
   ```

3. **Re-install skill**:
   ```bash
   rm -rf ~/.workbuddy/skills/ui-acceptance-checker/
   # Re-copy from marketplace or re-create
   ```

4. **File an issue** (if hosted on GitHub):
   ```
   https://github.com/your-repo/ui-acceptance-checker/issues
   ```

---

## 8. FAQ

**Q: Can I compare Figma designs with local HTML files (not deployed URLs)?**  
**A**: Yes! Use `file://` protocol or local server:
```bash
# Option 1: Local server
python3 -m http.server 8000
# Then use http://localhost:8000 in skill

# Option 2: File protocol (may have CORS issues)
file:///path/to/local/file.html
```

---

**Q: How do I exclude a specific UI element from comparison (e.g., timestamps)?**  
**A**: Use masking in `image-compare.js`:
```javascript
excludeRegions: [
  { x: 100, y: 50, width: 200, height: 30 }  // Timestamp
]
```

---

**Q: Can I run this skill in CI/CD pipeline (GitHub Actions, Jenkins)?**  
**A**: Yes! Ensure:
1. Figma API token as secret environment variable
2. Playwright browsers installed in CI environment
3. Headless mode enabled (`headless: true`)

---

**Q: Comparison fails on CI but passes locally. Why?**  
**A**: Likely caused by:
1. **Different browser versions** (Chrome vs Chromium)
2. **Different font rendering** (macOS vs Linux)
3. **Different screen resolutions** (affects screenshots)

**Fix**: Use Docker container with fixed browser + font versions.

---

**End of Troubleshooting Guide**
