import 'dotenv/config';
import { chromium } from 'playwright';
import path from 'path';

async function main() {
  const artifactDir = 'C:\\Users\\SC-RAUF\\.gemini\\antigravity\\brain\\fb5d9e17-9e1f-47b0-bfd2-4e418cc70318';

  const browser = await chromium.launch({
    channel: 'msedge',
    headless: true,
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });

  // Create super admin session cookie
  // In dev mode, we can set session / user
  const page = await context.newPage();

  // Login as super admin via dev profile or direct session
  console.log('Navigating to login / dev profile...');
  await page.goto('http://localhost:3000/login');
  await page.waitForTimeout(1000);

  // If login form has dev profiles, or login directly
  const superAdminBtn = page.locator('button:has-text("Super Admin"), [data-role="SUPER_ADMIN"]').first();
  if (await superAdminBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await superAdminBtn.click();
    await page.waitForTimeout(1500);
  } else {
    // Fill credentials
    const usernameInput = page.locator('input[type="text"], input[name="username"]').first();
    const passwordInput = page.locator('input[type="password"]').first();
    if (await usernameInput.isVisible().catch(() => false)) {
      await usernameInput.fill('superadmin');
      await passwordInput.fill('admin123');
      await page.locator('button[type="submit"]').click();
      await page.waitForTimeout(2000);
    }
  }

  // 1. Capture Super Admin Lab Policies (showing the 3-card grid)
  console.log('Navigating to /super-admin/test-policies...');
  await page.goto('http://localhost:3000/super-admin/test-policies', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({
    path: path.join(artifactDir, 'super_admin_policies_3cards.png'),
    fullPage: false,
  });
  console.log('Saved super_admin_policies_3cards.png');

  // 2. Capture Super Admin Daily Report Dashboard
  console.log('Navigating to /super-admin/daily-report...');
  await page.goto('http://localhost:3000/super-admin/daily-report', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({
    path: path.join(artifactDir, 'super_admin_daily_report_dashboard.png'),
    fullPage: false,
  });
  console.log('Saved super_admin_daily_report_dashboard.png');

  // 3. Click "Send Report" to open the SendReportModal and capture it
  console.log('Clicking "Send Report" button...');
  const sendReportBtn = page.locator('button:has-text("Send Report")').first();
  if (await sendReportBtn.isVisible()) {
    await sendReportBtn.click();
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: path.join(artifactDir, 'super_admin_daily_report_send_modal.png'),
      fullPage: false,
    });
    console.log('Saved super_admin_daily_report_send_modal.png');
  }

  await browser.close();
  console.log('ALL SCREENSHOTS CAPTURED CLEANLY!');
}

main().catch((err) => {
  console.error('Capture error:', err);
  process.exit(1);
});
