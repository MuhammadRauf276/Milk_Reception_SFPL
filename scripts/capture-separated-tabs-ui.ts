import 'dotenv/config';
import { chromium } from 'playwright';
import path from 'path';
import { prisma } from '../src/backend/core/db';
import { createSessionToken } from '../src/backend/core/auth';

async function main() {
  const artifactDir = 'C:\\Users\\SC-RAUF\\.gemini\\antigravity\\brain\\fb5d9e17-9e1f-47b0-bfd2-4e418cc70318';

  const superAdmin = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN', is_active: true } });
  if (!superAdmin) {
    throw new Error('No active SUPER_ADMIN user found.');
  }

  const token = await createSessionToken({
    id: String(superAdmin.id),
    username: superAdmin.username,
    name: superAdmin.full_name || superAdmin.username,
    role: superAdmin.role as any,
    department: superAdmin.department || 'ADMIN',
  } as any);

  const browser = await chromium.launch({
    channel: 'msedge',
    headless: true,
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });

  await context.addCookies([
    {
      name: 'auth_token',
      value: token,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);

  const page = await context.newPage();

  // 1. Capture Clean Lab Policies (without any top cards, wait for table data)
  console.log('Navigating to /super-admin/test-policies...');
  await page.goto('http://localhost:3000/super-admin/test-policies', { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(3000);
  await page.screenshot({
    path: path.join(artifactDir, 'super_admin_lab_policies_clean.png'),
    fullPage: false,
  });
  console.log('Saved super_admin_lab_policies_clean.png');

  // 2. Capture Reports & Governance (Sub-tab 1: Daily Quality & Ops)
  console.log('Navigating to /super-admin/reports?tab=daily...');
  await page.goto('http://localhost:3000/super-admin/reports?tab=daily', { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(3000);
  await page.screenshot({
    path: path.join(artifactDir, 'super_admin_reports_governance_daily.png'),
    fullPage: false,
  });
  console.log('Saved super_admin_reports_governance_daily.png');

  // 3. Capture Reports & Governance (Sub-tab 2: Work for Lower Roles)
  console.log('Navigating to /super-admin/reports?tab=hierarchy...');
  await page.goto('http://localhost:3000/super-admin/reports?tab=hierarchy', { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(3000);
  await page.screenshot({
    path: path.join(artifactDir, 'super_admin_reports_governance_hierarchy.png'),
    fullPage: false,
  });
  console.log('Saved super_admin_reports_governance_hierarchy.png');

  // 4. Capture Reports & Governance (Sub-tab 3: Warning Limits & Policy)
  console.log('Navigating to /super-admin/reports?tab=warnings...');
  await page.goto('http://localhost:3000/super-admin/reports?tab=warnings', { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(3000);
  await page.screenshot({
    path: path.join(artifactDir, 'super_admin_reports_governance_warnings.png'),
    fullPage: false,
  });
  console.log('Saved super_admin_reports_governance_warnings.png');

  await browser.close();
  await prisma.$disconnect();
  console.log('ALL SEPARATED TABS SCREENSHOTS CAPTURED CLEANLY!');
}

main().catch((err) => {
  console.error('Capture error:', err);
  process.exit(1);
});
