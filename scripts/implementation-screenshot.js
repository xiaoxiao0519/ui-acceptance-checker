#!/usr/bin/env node
/**
 * Implementation Screenshot Capture
 * Uses Playwright Node.js API to capture screenshots of live implementation
 *
 * Usage:
 *   node implementation-screenshot.js <url> <output-path> <viewport-width> [viewport-height]
 *
 * Prerequisites:
 *   npm install playwright
 *   npx playwright install chromium
 *
 * Example:
 *   node implementation-screenshot.js "https://example.com" ./impl.png 1024 768
 */

const fs = require('fs');
const path = require('path');

// Parse command line arguments
const args = process.argv.slice(2);
if (args.length < 3) {
  console.error('Usage: node implementation-screenshot.js <url> <output-path> <viewport-width> [viewport-height]');
  console.error('Example: node implementation-screenshot.js "https://example.com" ./impl.png 1024 768');
  process.exit(1);
}

const url = args[0];
const outputPath = args[1];
const viewportWidth = parseInt(args[2]) || 1024;
const viewportHeight = parseInt(args[3]) || 768;

// CSS to hide common dynamic/intrusive elements
const HIDE_DYNAMIC_CSS = `
  .ad-banner, .ad-container, .popup, .modal-overlay,
  .cookie-banner, .cookie-consent, .newsletter-popup,
  [class*="ads"], [id*="ads"], [class*="tracker"],
  .live-chat-widget, .feedback-widget {
    display: none !important;
  }
`;

// Main execution
async function main() {
  let browser = null;
  try {
    console.log('Implementation Screenshot Capture');
    console.log('='.repeat(60));
    console.log(`   URL: ${url}`);
    console.log(`   Viewport: ${viewportWidth}x${viewportHeight}`);
    console.log(`   Output: ${outputPath}`);
    console.log('');

    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    if (outputDir && !fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
      console.log(`   Created output directory: ${outputDir}`);
    }

    // Dynamically import Playwright
    console.log('   Loading Playwright...');
    let chromium;
    try {
      const pw = require('playwright');
      chromium = pw.chromium;
    } catch (err) {
      console.error('   Error: playwright module not found.');
      console.error('   Install it with: npm install playwright && npx playwright install chromium');
      process.exit(1);
    }

    // Launch browser
    console.log('   Launching browser...');
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext({
      viewport: { width: viewportWidth, height: viewportHeight },
      deviceScaleFactor: 1,
      ignoreHTTPSErrors: true
    });

    const page = await context.newPage();

    // Navigate to URL
    console.log(`   Navigating to ${url}...`);
    const response = await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: 60000
    });

    if (!response) {
      throw new Error('Page did not return a response');
    }

    console.log(`   Page loaded (status: ${response.status()})`);

    // Hide dynamic elements
    await page.addStyleTag({ content: HIDE_DYNAMIC_CSS });

    // Wait for fonts to load
    try {
      await page.waitForFunction(() => document.fonts.ready.then(() => true), { timeout: 5000 });
      console.log('   Fonts loaded');
    } catch (e) {
      console.log('   Font wait timed out, continuing...');
    }

    // Additional wait for lazy-loaded content
    await page.waitForTimeout(1500);

    // Take screenshot
    console.log('   Capturing screenshot...');
    await page.screenshot({
      path: outputPath,
      fullPage: false,  // First screen only for comparison consistency
      type: 'png'
    });

    // Verify file
    if (fs.existsSync(outputPath)) {
      const stats = fs.statSync(outputPath);
      console.log(`   Saved: ${outputPath} (${(stats.size / 1024).toFixed(1)} KB)`);
    } else {
      throw new Error('Screenshot file not created');
    }

    console.log('');
    console.log('Done!');

  } catch (error) {
    console.error('');
    console.error(`Error: ${error.message}`);
    console.error('');
    console.error('Troubleshooting:');
    console.error('  1. Ensure URL is accessible');
    console.error('  2. Install playwright: npm install playwright && npx playwright install chromium');
    console.error('  3. Check if URL requires authentication');
    console.error('  4. Try with HTTP instead of HTTPS if having SSL issues');
    process.exit(1);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

main();
