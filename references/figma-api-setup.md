# Figma API Setup Guide

## Getting Your Personal Access Token

1. **Log in to Figma** (https://www.figma.com)
2. **Go to Settings**: Click your avatar → **Settings**
3. **Create new token**: Scroll to "Personal access tokens" → **Create new token**
4. **Name it**: e.g., "UI Acceptance Checker"
5. **Copy the token** (starts with `figd_`)

## Configure Environment Variable

**Option A: Temporary (current session only)**
```bash
export FIGMA_TOKEN="figd_your-token-here"
```

**Option B: Permanent (recommended)**
Add to your shell profile (`~/.bashrc`, `~/.zshrc`, etc.):
```bash
echo 'export FIGMA_TOKEN="figd_your-token-here"' >> ~/.bashrc
```

**Option C: .env file (for project-specific)**
Create `.env` in your project root:
```
FIGMA_TOKEN=figd_your-token-here
```

## Verify API Access

Test your token:
```bash
curl -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/me"
```

Expected response:
```json
{
  "id": "123456789",
  "email": "your-email@example.com",
  "handle": "yourname",
  "img_url": "..."
}
```

## API Rate Limits

- **Personal tokens**: 100 requests/minute
- **OAuth tokens**: 1000 requests/minute

For bulk operations, add delays between requests:
```python
import time
time.sleep(0.6)  # 600ms delay = ~100 requests/minute
```

## Common API Endpoints Used

### 1. Get File Data
```bash
GET https://api.figma.com/v1/files/:file_key
```

**Used for**: Extracting design structure, layers, components

### 2. Get Images (Export)
```bash
GET https://api.figma.com/v1/images/:file_key?ids=:node_ids&format=png&scale=2
```

**Used for**: Exporting high-res design screenshots

**Parameters**:
- `format`: png, jpg, svg, pdf
- `scale`: 1, 2, 3, 4 (pixel density)
- `ids`: Comma-separated node IDs

### 3. Get File Images (Batch Export)
```bash
GET https://api.figma.com/v1/files/:file_key/images
```

**Used for**: Batch export multiple frames

## Parsing Figma URLs

Extract `file_key` and `node_id` from URLs:

**URL format**:
```
https://www.figma.com/file/[FILE_KEY]/[FILE_NAME]?node-id=[NODE_ID]
https://www.figma.com/design/[FILE_KEY]/[FILE_NAME]?node-id=[NODE_ID]
```

**Examples**:
```javascript
// Input URL
"https://www.figma.com/file/ABC123/My-Design?node-id=1:2"

// Extracted
file_key = "ABC123"
node_id = "1:2"  // or "1-2" (API sometimes uses hyphen)
```

**Node ID formats**:
- `1:2` (colon) - Used in URL
- `1-2` (hyphen) - Used in API requests

## Extracting Design Tokens

After fetching file data, extract relevant design tokens:

```javascript
// Example: Extract colors from a frame
const frame = figmaData.document.nodes[0];
const colors = extractColors(frame);
const typography = extractTypography(frame);
const spacing = extractSpacing(frame);

function extractColors(node) {
  const colors = [];
  if (node.fills) {
    node.fills.forEach(fill => {
      if (fill.type === "SOLID") {
        colors.push(fill.color);
      }
    });
  }
  if (node.children) {
    node.children.forEach(child => {
      colors.push(...extractColors(child));
    });
  }
  return colors;
}
```

## Image Export Best Practices

**For UI acceptance testing**, export at **2x or 3x scale**:
```bash
# 2x scale (recommended for most screens)
curl -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/images/$FILE_KEY?ids=$NODE_ID&format=png&scale=2"

# 3x scale (for high-density displays)
curl -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/images/$FILE_KEY?ids=$NODE_ID&format=png&scale=3"
```

**Viewport matching**:
Match exported image width to your breakpoint:
- 1024px breakpoint → Export at 1024px width (scale=1) or 2048px (scale=2)
- 1920px breakpoint → Export at 1920px width

## Troubleshooting

### Error: 403 Forbidden
**Cause**: Invalid or expired token
**Fix**: Generate a new token in Figma settings

### Error: 404 Not Found
**Cause**: Incorrect file_key or node_id
**Fix**: Double-check URL; ensure file is accessible

### Error: Rate limit exceeded
**Cause**: Too many API requests
**Fix**: Add delays between requests (see Rate Limits section)

### Image export returns {"err": "Invalid token"}
**Cause**: Token not passed correctly
**Fix**: Ensure header is `X-Figma-Token`, not `Authorization`

## Reference Links

- [Figma API Documentation](https://www.figma.com/developers/api#files-endpoints)
- [Personal Access Tokens Guide](https://help.figma.com/hc/en-us/articles/8085703771159)
- [Rate Limiting Details](https://www.figma.com/developers/api#rate-limits)
