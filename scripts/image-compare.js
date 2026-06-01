#!/usr/bin/env node
/**
 * Image Comparison Tool
 * Uses ImageMagick to compare design screenshot with implementation screenshot
 *
 * Usage:
 *   node image-compare.js <design-image> <impl-image> <output-diff>
 *
 * Prerequisites:
 *   ImageMagick installed (compare command available)
 *   - Windows: choco install imagemagick
 *   - macOS: brew install imagemagick
 *   - Ubuntu: sudo apt-get install imagemagick
 *
 * Example:
 *   node image-compare.js ./design.png ./impl.png ./diff.png
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Parse command line arguments
const args = process.argv.slice(2);
if (args.length < 3) {
  console.error('Usage: node image-compare.js <design-image> <impl-image> <output-diff>');
  console.error('Example: node image-compare.js ./design.png ./impl.png ./diff.png');
  process.exit(1);
}

const designImage = args[0];
const implImage = args[1];
const outputDiff = args[2];

// Detect ImageMagick command
function detectImageMagick() {
  try {
    execSync('magick -version', { stdio: 'pipe' });
    return 'magick';
  } catch (e) {
    try {
      execSync('compare -version', { stdio: 'pipe' });
      return 'compare';
    } catch (e2) {
      return null;
    }
  }
}

// Build compare command (prefix with 'magick' if needed)
function buildCompareCmd(baseCmd, subCmd) {
  if (baseCmd === 'magick') {
    return `magick ${subCmd}`;
  }
  return subCmd;
}

// Run ImageMagick command and return { stdout, stderr }
function runIM(cmd) {
  try {
    const stdout = execSync(cmd, { stdio: 'pipe', encoding: 'utf-8' });
    return { stdout: stdout.trim(), stderr: '', code: 0 };
  } catch (error) {
    return {
      stdout: (error.stdout || '').toString().trim(),
      stderr: (error.stderr || '').toString().trim(),
      code: error.status || 1
    };
  }
}

// Main execution
async function main() {
  try {
    console.log('Image Comparison Tool');
    console.log('='.repeat(60));
    console.log(`   Design Image:    ${designImage}`);
    console.log(`   Implementation:  ${implImage}`);
    console.log(`   Output Diff:     ${outputDiff}`);
    console.log('');

    // Validate input files
    console.log('   Validating input files...');
    if (!fs.existsSync(designImage)) {
      throw new Error(`Design image not found: ${designImage}`);
    }
    if (!fs.existsSync(implImage)) {
      throw new Error(`Implementation image not found: ${implImage}`);
    }
    const designSize = fs.statSync(designImage).size;
    const implSize = fs.statSync(implImage).size;
    console.log(`   Design: ${(designSize / 1024).toFixed(1)} KB, Impl: ${(implSize / 1024).toFixed(1)} KB`);

    // Ensure output directory exists
    const outputDir = path.dirname(outputDiff);
    if (outputDir && !fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
      console.log(`   Created output directory: ${outputDir}`);
    }

    // Detect ImageMagick
    console.log('');
    console.log('   Detecting ImageMagick...');
    const imCmd = detectImageMagick();
    if (!imCmd) {
      console.error('   Error: ImageMagick not found.');
      console.error('');
      console.error('   Installation:');
      console.error('     Windows: choco install imagemagick');
      console.error('     macOS:   brew install imagemagick');
      console.error('     Ubuntu:  sudo apt-get install imagemagick');
      process.exit(1);
    }
    console.log(`   Using: ${imCmd}`);

    // Step 1: Ensure images are same size
    console.log('');
    console.log('   Checking image dimensions...');

    const designIdentify = runIM(buildCompareCmd(imCmd, `identify -format "%w %h" "${designImage}"`));
    const implIdentify = runIM(buildCompareCmd(imCmd, `identify -format "%w %h" "${implImage}"`));

    if (!designIdentify.stdout || !implIdentify.stdout) {
      throw new Error('Failed to get image dimensions');
    }

    const [dw, dh] = designIdentify.stdout.trim().split(' ').map(Number);
    const [iw, ih] = implIdentify.stdout.trim().split(' ').map(Number);
    console.log(`   Design: ${dw}x${dh}, Impl: ${iw}x${ih}`);

    let finalDesignPath = designImage;
    let finalImplPath = implImage;

    if (dw !== iw || dh !== ih) {
      console.log('   Dimensions differ, resizing implementation to match design...');
      const resizedPath = outputDiff.replace(/\.[^/.]+$/, '-resized.png');
      const resizeCmd = buildCompareCmd(imCmd, `convert "${implImage}" -resize ${dw}x${dh}! "${resizedPath}"`);
      runIM(resizeCmd);
      if (fs.existsSync(resizedPath)) {
        finalImplPath = resizedPath;
        console.log(`   Resized: ${resizedPath}`);
      } else {
        console.log('   Warning: Resize failed, comparing as-is (results may be inaccurate)');
      }
    }

    // Step 2: RMSE pixel comparison + generate diff image
    console.log('');
    console.log('   Running RMSE comparison...');
    const rmseCmd = buildCompareCmd(imCmd, `compare -metric RMSE -fuzz 5% "${finalDesignPath}" "${finalImplPath}" "${outputDiff}"`);
    const rmseResult = runIM(rmseCmd);

    let rmseScore = 0;
    // ImageMagick outputs RMSE to stderr, format like "1234.56 (0.0187654)"
    const rmseMatch = (rmseResult.stderr || rmseResult.stdout).match(/\((\d+\.\d+)\)/);
    if (rmseMatch) {
      rmseScore = parseFloat(rmseMatch[1]);
    }
    console.log(`   RMSE Score: ${rmseScore.toFixed(6)}`);

    // Check if diff image was generated
    const diffGenerated = fs.existsSync(outputDiff);
    if (diffGenerated) {
      console.log(`   Diff image: ${outputDiff}`);
    } else {
      console.log('   Warning: Diff image not generated');
    }

    // Step 3: SSIM structural similarity
    console.log('');
    console.log('   Running SSIM comparison...');
    const ssimCmd = buildCompareCmd(imCmd, `compare -metric SSIM "${finalDesignPath}" "${finalImplPath}" null:`);
    const ssimResult = runIM(ssimCmd);

    let ssimScore = 0;
    // SSIM output format: "0.987654" (direct value, higher is better)
    const ssimOutput = (ssimResult.stderr || ssimResult.stdout).trim();
    const ssimMatch = ssimOutput.match(/(\d+\.\d+)/);
    if (ssimMatch) {
      ssimScore = parseFloat(ssimMatch[1]);
    }
    console.log(`   SSIM Score: ${ssimScore.toFixed(6)}`);

    // Step 4: Calculate pass/fail
    console.log('');
    console.log('   Results:');
    console.log('   '.repeat(60));

    const rmsePass = rmseScore < 0.05;
    const ssimPass = ssimScore > 0.95;
    const overallPass = rmsePass && ssimPass;

    if (overallPass) {
      console.log('   Verdict: PASS - Design and implementation match well');
    } else if (rmseScore < 0.15 && ssimScore > 0.85) {
      console.log('   Verdict: REVIEW - Minor differences detected, manual review needed');
    } else {
      console.log('   Verdict: FAIL - Significant differences detected');
    }

    console.log('');
    console.log('   Summary:');
    console.log(`     RMSE:      ${rmseScore.toFixed(6)} ${rmsePass ? '(PASS)' : rmseScore < 0.15 ? '(REVIEW)' : '(FAIL)'}`);
    console.log(`     SSIM:      ${ssimScore.toFixed(6)} ${ssimPass ? '(PASS)' : ssimScore > 0.85 ? '(REVIEW)' : '(FAIL)'}`);
    console.log(`     Overall:   ${overallPass ? 'PASS' : 'REVIEW/FAIL'}`);
    console.log(`     Diff:      ${diffGenerated ? outputDiff : '(not generated)'}`);

    // Write JSON report
    const reportPath = outputDiff.replace(/\.[^/.]+$/, '-report.json');
    const report = {
      timestamp: new Date().toISOString(),
      design_image: designImage,
      implementation_image: implImage,
      diff_image: diffGenerated ? outputDiff : null,
      rmse_score: rmseScore,
      ssim_score: ssimScore,
      rmse_pass: rmsePass,
      ssim_pass: ssimPass,
      overall_pass: overallPass,
      verdict: overallPass ? 'pass' : (rmseScore < 0.15 && ssimScore > 0.85) ? 'review' : 'fail',
      design_dimensions: { width: dw, height: dh },
      impl_dimensions: { width: iw, height: ih }
    };
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`     Report:    ${reportPath}`);

    // Exit with non-zero for CI integration
    if (!overallPass && report.verdict === 'fail') {
      process.exit(1);
    }

  } catch (error) {
    console.error('');
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

main();
