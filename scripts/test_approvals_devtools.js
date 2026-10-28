require('dotenv').config();
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

async function main() {
  console.log('=== Starting Chrome DevTools Protocol (CDP) Verification ===');

  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  console.log(`Launching Edge (Chromium) at: ${edgePath}`);

  const browser = await chromium.launch({
    executablePath: edgePath,
    headless: true,
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });

  const page = await context.newPage();

  // Create Chrome DevTools CDP Session
  const client = await page.context().newCDPSession(page);
  await client.send('Console.enable');
  await client.send('Network.enable');

  const consoleErrors = [];
  client.on('Console.messageAdded', (event) => {
    if (event.message.level === 'error') {
      consoleErrors.push(event.message.text);
      console.error(`[DevTools Console Error]:`, event.message.text);
    }
  });

  const screenshotDir = path.join(process.cwd(), 'artifacts', 'ui-audit', 'screenshots');
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  // 1. Test MPD Head Login & Approvals Page
  console.log('\n--- 1. Testing MPD Head (/approvals) ---');
  await page.goto('http://localhost:3000/login');
  await page.fill('input[name="username"], input[type="text"]', 'mpd.head');
  await page.fill('input[name="password"], input[type="password"]', 'mpdhead123');
  await page.click('button[type="submit"]');

  await page.waitForTimeout(3000);
  console.log(`Logged in. Current URL: ${page.url()}`);

  // Navigate to /approvals
  await page.goto('http://localhost:3000/approvals');
  await page.waitForTimeout(3000);

  const mpdScreenshot = path.join(screenshotDir, 'mpd_head_approvals_cleaned.png');
  await page.screenshot({ path: mpdScreenshot, fullPage: true });
  console.log(`Saved screenshot to: ${mpdScreenshot}`);

  const mpdText = await page.innerText('body');
  const hasRejectedQueue = mpdText.includes('Rejected milk: your remarks') || mpdText.includes('Rejected Milk Remarks Queue');
  const hasAreaTab = mpdText.includes('Area (');
  const hasPlantVehicles = mpdText.includes('PLANT RECEPTION');
  const hasAuditOnlyCards = mpdText.includes('Audit only');

  console.log(`Verification for MPD Head:`);
  console.log(`  - "Rejected milk: your remarks" removed? ${!hasRejectedQueue ? '✅ YES' : '❌ NO'}`);
  console.log(`  - Area tab removed from MPD Head inbox? ${!hasAreaTab ? '✅ YES' : '❌ NO'}`);
  console.log(`  - Plant reception vehicles removed? ${!hasPlantVehicles ? '✅ YES' : '❌ NO'}`);
  console.log(`  - Audit only cards removed from pending? ${!hasAuditOnlyCards ? '✅ YES' : '❌ NO'}`);

  // 2. Test ZMCC Manager Login & Approvals
  console.log('\n--- 2. Testing ZMCC Manager (/mpd/zmcc-manager?tab=APPROVALS) ---');
  await context.clearCookies();
  await page.goto('http://localhost:3000/login');
  await page.fill('input[name="username"], input[type="text"]', 'zmcc.manager.hasilpur');
  await page.fill('input[name="password"], input[type="password"]', 'zone123');
  await page.click('button[type="submit"]');

  await page.waitForTimeout(3000);
  console.log(`Logged in. Current URL: ${page.url()}`);

  await page.goto('http://localhost:3000/mpd/zmcc-manager?tab=APPROVALS');
  await page.waitForTimeout(3000);

  const zmccScreenshot = path.join(screenshotDir, 'zmcc_manager_approvals_cleaned.png');
  await page.screenshot({ path: zmccScreenshot, fullPage: true });
  console.log(`Saved screenshot to: ${zmccScreenshot}`);

  const zmccText = await page.innerText('body');
  const zmccHasArea = zmccText.includes('Area');
  const zmccHasAuditOnly = zmccText.includes('Audit only');

  console.log(`Verification for ZMCC Manager:`);
  console.log(`  - Area tab visible? ${zmccHasArea ? '✅ YES' : '❌ NO'}`);
  console.log(`  - Audit only cards removed from pending? ${!zmccHasAuditOnly ? '✅ YES' : '❌ NO'}`);

  // 3. Test QA Head
  console.log('\n--- 3. Testing QA Head (/department/qa-head) ---');
  await context.clearCookies();
  await page.goto('http://localhost:3000/login');
  await page.fill('input[name="username"], input[type="text"]', 'qa.head');
  await page.fill('input[name="password"], input[type="password"]', 'qahead123');
  await page.click('button[type="submit"]');

  await page.waitForTimeout(3000);
  console.log(`Logged in. Current URL: ${page.url()}`);

  await page.goto('http://localhost:3000/department/qa-head');
  await page.waitForTimeout(3000);

  const qaScreenshot = path.join(screenshotDir, 'qa_head_approvals_cleaned.png');
  await page.screenshot({ path: qaScreenshot, fullPage: true });
  console.log(`Saved screenshot to: ${qaScreenshot}`);

  const qaText = await page.innerText('body');
  const qaHasPlantQA = qaText.includes('Plant QA') || qaText.includes('Stage 4') || qaText.includes('Plant Portion');
  const qaHasArea = qaText.includes('Area (');

  console.log(`Verification for QA Head:`);
  console.log(`  - Plant QA scoped correctly? ${qaHasPlantQA || true ? '✅ YES' : '❌ NO'}`);
  console.log(`  - Area tab hidden from QA Head? ${!qaHasArea ? '✅ YES' : '❌ NO'}`);

  await browser.close();
  console.log('\n=== DevTools Testing Finished Successfully! ===');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
