#!/usr/bin/env node
/**
 * Figma Design Screenshot Extractor
 *
 * Usage:
 *   node figma-screenshot.js <figma-url> <output-path> [scale]
 *
 * Supports:
 *   - Frame link (with node-id): https://www.figma.com/file/KEY/Name?node-id=1:2
 *   - Project link (no node-id): https://www.figma.com/file/KEY/Name → auto-selects first Frame
 *   - /file/ and /design/ URL prefixes
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Get Figma token from environment
const FIGMA_TOKEN = process.env.FIGMA_TOKEN;

if (!FIGMA_TOKEN) {
  console.error('Error: FIGMA_TOKEN environment variable not set');
  console.error('Set it with: export FIGMA_TOKEN="your-token"');
  process.exit(1);
}

// Parse command line arguments
const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: node figma-screenshot.js <figma-url> <output-path> [scale]');
  console.error('Example: node figma-screenshot.js "https://www.figma.com/file/ABC123/Design" ./design.png 2');
  process.exit(1);
}

const figmaUrl = args[0];
const outputPath = args[1];
const scale = parseInt(args[2]) || 2;

// Parse Figma URL to extract file key and node ID
function parseFigmaUrl(url) {
  const fileMatch = url.match(/figma\.com\/(file|design)\/([a-zA-Z0-9]+)/);
  const nodeMatch = url.match(/node-id=([^&]+)/);

  if (!fileMatch) {
    throw new Error('Invalid Figma URL: Could not extract file key. Expected format: https://www.figma.com/file/KEY/Name or https://www.figma.com/design/KEY/Name');
  }

  const fileKey = fileMatch[2];
  // node-id in URL uses colon (1:2), API uses hyphen (1-2)
  const nodeId = nodeMatch ? decodeURIComponent(nodeMatch[1]).replace(':', '-') : null;

  return { fileKey, nodeId };
}

// Call Figma API
function callFigmaAPI(endpoint) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.figma.com',
      path: endpoint,
      method: 'GET',
      headers: {
        'X-Figma-Token': FIGMA_TOKEN,
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Failed to parse Figma API response: ${e.message}`));
          }
        } else {
          reject(new Error(`Figma API error: ${res.statusCode} ${data}`));
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Figma API request timed out (30s)'));
    });

    req.end();
  });
}

// Get the first exportable frame node from a Figma file
async function getFirstFrameNodeId(fileKey) {
  console.log('   Fetching file structure to find first Frame...');
  const response = await callFigmaAPI(`/v1/files/${fileKey}?depth=2`);

  if (!response.document || !response.document.children) {
    throw new Error('No document found in Figma file');
  }

  // Recursively find the first FRAME node
  function findFirstFrame(node) {
    if (node.type === 'FRAME' || node.type === 'CANVAS') {
      return node.id;
    }
    if (node.children) {
      for (const child of node.children) {
        const found = findFirstFrame(child);
        if (found) return found;
      }
    }
    return null;
  }

  // Search through pages
  for (const page of response.document.children) {
    const frameId = findFirstFrame(page);
    if (frameId) {
      console.log(`   Found Frame: ${page.name} > (frame ${frameId})`);
      return frameId;
    }
  }

  throw new Error('No Frame/CANVAS node found in Figma file');
}

// Get image export URL from Figma
async function getFigmaImageUrl(fileKey, nodeId, scale) {
  const endpoint = `/v1/images/${fileKey}?ids=${nodeId}&format=png&scale=${scale}`;
  console.log(`   Fetching image export URL from Figma (scale=${scale}x)...`);
  const response = await callFigmaAPI(endpoint);

  if (!response.images || !response.images[nodeId]) {
    const errDetail = response.images ? JSON.stringify(response.images) : 'empty response';
    throw new Error(`Failed to get image export URL for node ${nodeId}. Response: ${errDetail}`);
  }

  return response.images[nodeId];
}

// Download image from URL
function downloadImage(url, outputPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(outputPath);

    const protocol = url.startsWith('https') ? https : http;
    protocol.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow redirect
        file.close();
        fs.unlinkSync(outputPath);
        downloadImage(res.headers.location, outputPath).then(resolve).catch(reject);
        return;
      }

      if (res.statusCode !== 200) {
        file.close();
        fs.unlink(outputPath, () => {});
        reject(new Error(`Download failed with status ${res.statusCode}`));
        return;
      }

      res.pipe(file);

      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(outputPath, () => {});
      reject(err);
    });
  });
}

// Main execution
async function main() {
  try {
    console.log('Figma Screenshot Extractor');
    console.log('='.repeat(60));

    // Parse URL
    console.log(`Parsing Figma URL: ${figmaUrl}`);
    const { fileKey, nodeId } = parseFigmaUrl(figmaUrl);

    console.log(`   File Key: ${fileKey}`);
    console.log(`   Node ID: ${nodeId || '(auto-detect)'}`);
    console.log(`   Scale: ${scale}x`);

    // If no nodeId, find the first Frame
    let targetNodeId = nodeId;
    if (!targetNodeId) {
      targetNodeId = await getFirstFrameNodeId(fileKey);
    }

    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    if (outputDir && !fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
      console.log(`   Created output directory: ${outputDir}`);
    }

    // Get image export URL
    const imageUrl = await getFigmaImageUrl(fileKey, targetNodeId, scale);
    console.log(`   Image URL obtained`);

    // Download image
    console.log(`   Downloading screenshot...`);
    await downloadImage(imageUrl, outputPath);

    // Verify file
    if (fs.existsSync(outputPath)) {
      const stats = fs.statSync(outputPath);
      console.log(`   Saved: ${outputPath} (${(stats.size / 1024).toFixed(1)} KB)`);
    }

    console.log('Done!');

  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

main();
