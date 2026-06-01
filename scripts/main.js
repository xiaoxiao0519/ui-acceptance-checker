#!/usr/bin/env node
/**
 * UI Acceptance Checker - Main Execution Script
 *
 * Orchestrates the full workflow:
 *   1. Extract design screenshots from Figma
 *   2. Capture implementation screenshots via Playwright
 *   3. Compare images using ImageMagick
 *   4. Generate acceptance report
 *
 * Usage:
 *   node main.js --page "figma-url|impl-url" [--page "figma-url|impl-url" ...] [--viewport 1920]
 *
 * Prerequisites:
 *   export FIGMA_TOKEN="figd_your-token"
 *   npm install playwright && npx playwright install chromium
 *   ImageMagick installed (compare command available)
 *
 * Example (single page):
 *   node main.js \
 *     --page "https://www.figma.com/file/ABC123/My-Design?node-id=1:2|https://staging.example.com/dashboard"
 *
 * Example (multiple pages):
 *   node main.js \
 *     --page "https://www.figma.com/file/ABC123?node-id=1:2|https://example.com/home" \
 *     --page "https://www.figma.com/file/ABC123?node-id=3:4|https://example.com/settings" \
 *     --viewport 1440
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Parse command line arguments
const args = process.argv.slice(2);
const params = { pages: [] };

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--page' && args[i + 1] && !args[i + 1].startsWith('--')) {
    const raw = args[i + 1];
    const sepIndex = raw.indexOf('|');
    if (sepIndex === -1) {
      console.error(`Error: --page value must contain "|" separator. Got: ${raw}`);
      console.error('Format: --page "figma-url|impl-url"');
      process.exit(1);
    }
    params.pages.push({
      design: raw.slice(0, sepIndex).trim(),
      impl: raw.slice(sepIndex + 1).trim()
    });
    i++;
  } else if (args[i].startsWith('--')) {
    const key = args[i].slice(2);
    const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true;
    params[key] = value;
    if (value !== true) i++;
  }
}

// Also support legacy --design / --impl for single page
if (params.pages.length === 0 && params.design && params.impl) {
  params.pages.push({ design: params.design, impl: params.impl });
}

// Validate
if (params.pages.length === 0) {
  console.error('Usage: node main.js --page "figma-url|impl-url" [--page ...] [--viewport 1920]');
  console.error('');
  console.error('Examples:');
  console.error('  node main.js --page "https://figma.com/file/ABC?node-id=1:2|https://example.com/home"');
  console.error('  node main.js --page "https://figma.com/...?node-id=1:2|https://example.com/home" \\');
  console.error('             --page "https://figma.com/...?node-id=3:4|https://example.com/settings"');
  console.error('');
  console.error('Legacy (single page):');
  console.error('  node main.js --design "https://figma.com/file/ABC" --impl "https://example.com/home"');
  process.exit(1);
}

// Viewport (single, default 1920)
const VIEWPORT = params.viewport ? parseInt(params.viewport) : 1920;

const TIMESTAMP = new Date().toISOString().split('T')[0];
const OUTPUT_DIR = `ui-acceptance-reports/${TIMESTAMP}`;
const SCREENSHOTS_DIR = `${OUTPUT_DIR}/screenshots`;
const SCRIPTS_DIR = __dirname;

// Run a script and return success/failure
function runScript(name, scriptArgs) {
  const cmd = `node "${path.join(SCRIPTS_DIR, name)}" ${scriptArgs}`;
  try {
    execSync(cmd, { stdio: 'inherit', timeout: 120000 });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Check prerequisites
function checkPrerequisites() {
  const issues = [];

  // Check FIGMA_TOKEN
  if (!process.env.FIGMA_TOKEN) {
    issues.push('FIGMA_TOKEN environment variable not set. Get it from Figma Settings > Personal access tokens.');
  }

  // Check Node.js
  try {
    const version = execSync('node --version', { stdio: 'pipe', encoding: 'utf-8' }).trim();
    console.log(`   Node.js: ${version}`);
  } catch (e) {
    issues.push('Node.js not found');
  }

  // Check Playwright
  try {
    require.resolve('playwright');
    console.log('   Playwright: installed');
  } catch (e) {
    issues.push('Playwright not installed. Run: npm install playwright && npx playwright install chromium');
  }

  // Check ImageMagick
  try {
    execSync('magick -version', { stdio: 'pipe' });
    console.log('   ImageMagick: installed (magick)');
  } catch (e) {
    try {
      execSync('compare -version', { stdio: 'pipe' });
      console.log('   ImageMagick: installed (compare)');
    } catch (e2) {
      issues.push('ImageMagick not installed. Install: choco install imagemagick (Windows) / brew install imagemagick (macOS)');
    }
  }

  return issues;
}

// Main execution
async function main() {
  const totalPages = params.pages.length;

  console.log('');
  console.log('  UI Acceptance Checker v2.0.0');
  console.log('  ========================================');
  console.log('');
  console.log('  Configuration:');
  console.log(`    Viewport:        ${VIEWPORT}px`);
  console.log(`    Pages:           ${totalPages}`);
  params.pages.forEach((p, i) => {
    console.log(`    [${i + 1}] Design: ${p.design}`);
    console.log(`        Impl:   ${p.impl}`);
  });
  console.log(`    Output:          ${OUTPUT_DIR}`);
  console.log('');

  // Step 0: Check prerequisites
  console.log('  [0/4] Checking prerequisites...');
  const issues = checkPrerequisites();
  if (issues.length > 0) {
    console.error('');
    console.error('  Prerequisites not met:');
    issues.forEach((issue, i) => console.error(`    ${i + 1}. ${issue}`));
    console.error('');
    process.exit(1);
  }
  console.log('         All checks passed.');
  console.log('');

  // Step 1: Create output directories
  console.log('  [1/4] Creating output directories...');
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }
  console.log(`         Created: ${SCREENSHOTS_DIR}`);
  console.log('');

  // Step 2: Process each page pair
  console.log(`  [2/4] Processing ${totalPages} page(s)...`);
  const pageResults = [];

  for (let idx = 0; idx < totalPages; idx++) {
    const page = params.pages[idx];
    const tag = `page-${idx + 1}`;
    console.log('');
    console.log(`  --- Page ${idx + 1}/${totalPages} ---`);

    // Extract design screenshot from Figma
    const designPath = path.resolve(SCREENSHOTS_DIR, `design-${tag}-${VIEWPORT}.png`);
    const designResult = runScript('figma-screenshot.js', `"${page.design}" "${designPath}" 2`);

    if (designResult.success) {
      console.log(`         Design screenshot: OK`);
    } else {
      console.log(`         Design screenshot: FAILED - ${designResult.error}`);
      pageResults.push({ tag, design: page.design, impl: page.impl, status: 'failed', error: 'Design screenshot failed' });
      continue;
    }

    // Capture implementation screenshot
    const implPath = path.resolve(SCREENSHOTS_DIR, `impl-${tag}-${VIEWPORT}.png`);
    const implResult = runScript('implementation-screenshot.js', `"${page.impl}" "${implPath}" ${VIEWPORT}`);

    if (implResult.success) {
      console.log(`         Impl screenshot: OK`);
    } else {
      console.log(`         Impl screenshot: FAILED - ${implResult.error}`);
      pageResults.push({ tag, design: page.design, impl: page.impl, status: 'failed', error: 'Implementation screenshot failed' });
      continue;
    }

    // Compare images
    const diffPath = path.resolve(SCREENSHOTS_DIR, `diff-${tag}-${VIEWPORT}.png`);
    const compareResult = runScript('image-compare.js', `"${designPath}" "${implPath}" "${diffPath}"`);

    let scores = {};
    if (compareResult.success) {
      const reportJsonPath = diffPath.replace(/\.[^/.]+$/, '-report.json');
      if (fs.existsSync(reportJsonPath)) {
        try { scores = JSON.parse(fs.readFileSync(reportJsonPath, 'utf-8')); } catch (e) { /* ignore */ }
      }
      console.log(`         Comparison: OK (verdict: ${scores.verdict || 'unknown'})`);
    } else {
      console.log(`         Comparison: FAILED - ${compareResult.error}`);
    }

    pageResults.push({
      tag,
      design: page.design,
      impl: page.impl,
      designPath,
      implPath,
      diffPath: fs.existsSync(diffPath) ? diffPath : null,
      scores,
      status: compareResult.success ? 'completed' : 'compare_failed'
    });
  }
  console.log('');

  // Step 3: Generate acceptance report
  console.log('  [3/4] Generating acceptance report...');
  const reportPath = path.resolve(OUTPUT_DIR, 'acceptance-report.md');
  const reportContent = generateReport(pageResults);
  fs.writeFileSync(reportPath, reportContent, 'utf-8');
  console.log(`         Report saved: ${reportPath}`);
  console.log('');

  // Step 4: Final summary
  console.log('  [4/4] Summary');
  console.log('');
  console.log('  ========================================');
  console.log('  UI Acceptance Check Complete!');
  console.log('');
  console.log(`  Pages:      ${totalPages} total`);

  const passed = pageResults.filter(r => r.scores && r.scores.overall_pass).length;
  const review = pageResults.filter(r => r.scores && r.scores.verdict === 'review' && !r.scores.overall_pass).length;
  const failed = pageResults.filter(r => r.status !== 'completed' || (r.scores && !r.scores.overall_pass && r.scores.verdict !== 'review')).length;

  console.log(`    Passed:    ${passed}`);
  console.log(`    Review:    ${review}`);
  console.log(`    Failed:    ${failed}`);
  console.log('');
  console.log(`  Report:     ${reportPath}`);
  console.log(`  Screenshots: ${SCREENSHOTS_DIR}`);
  console.log('');
}

// Generate Markdown report from page comparison results
// NOTE: This is the CI/CD simplified report (RMSE/SSIM + screenshots only).
// For the full 6-dimension acceptance report, use the AI Skill workflow
// which follows templates/references/report-template.md.
function generateReport(pageResults) {
  let report = '';
  report += '# UI Acceptance Report\n\n';
  report += `**Date**: ${TIMESTAMP}  \n`;
  report += `**Viewport**: ${VIEWPORT}px  \n\n`;

  // Summary table
  report += '---\n\n';
  report += '## Summary\n\n';
  report += '| # | Design | Implementation | RMSE | SSIM | Verdict |\n';
  report += '|---|--------|-----------------|------|------|--------|\n';

  pageResults.forEach((r, i) => {
    const shortDesign = r.design.length > 50 ? '...' + r.design.slice(-47) : r.design;
    const shortImpl = r.impl.length > 50 ? '...' + r.impl.slice(-47) : r.impl;

    if (r.status === 'completed' && r.scores) {
      const rmse = (r.scores.rmse_score || 0).toFixed(4);
      const ssim = (r.scores.ssim_score || 0).toFixed(4);
      const verdict = r.scores.overall_pass ? 'PASS' : (r.scores.verdict === 'review' ? 'REVIEW' : 'FAIL');
      report += `| ${i + 1} | ${shortDesign} | ${shortImpl} | ${rmse} | ${ssim} | **${verdict}** |\n`;
    } else {
      report += `| ${i + 1} | ${shortDesign} | ${shortImpl} | - | - | ERROR |\n`;
    }
  });

  // Per-page screenshots
  report += '\n---\n\n';
  report += '## Screenshots\n\n';

  pageResults.forEach((r, i) => {
    if (r.status === 'completed') {
      report += `### Page ${i + 1}\n\n`;
      report += `**Design**: ${r.design}  \n`;
      report += `**Implementation**: ${r.impl}  \n\n`;
      report += '| Design | Implementation | Diff |\n';
      report += '|--------|-----------------|------|\n';
      report += `| ![Design](screenshots/${path.basename(r.designPath)}) | ![Impl](screenshots/${path.basename(r.implPath)}) | ![Diff](screenshots/${path.basename(r.diffPath || '')}) |\n\n`;
    } else {
      report += `### Page ${i + 1}\n\n`;
      report += `**Design**: ${r.design}  \n`;
      report += `**Implementation**: ${r.impl}  \n\n`;
      report += `> Failed: ${r.error}\n\n`;
    }
  });

  report += '---\n\n';
  report += '_Generated by UI Acceptance Checker v2.0.0_\n';

  return report;
}

// Run
main().catch(error => {
  console.error('');
  console.error('  UI Acceptance Check Failed!');
  console.error('');
  console.error(`  Error: ${error.message}`);
  console.error('');
  console.error('  Troubleshooting:');
  console.error('    1. Check logs above for specific error');
  console.error('    2. Verify FIGMA_TOKEN is set');
  console.error('    3. Ensure playwright is installed');
  console.error('    4. Check ImageMagick is installed');
  console.error('');
  process.exit(1);
});
