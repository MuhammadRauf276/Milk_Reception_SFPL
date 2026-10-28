import 'dotenv/config';
import { chromium } from 'playwright';
import path from 'path';
import { prisma } from '../src/backend/core/db';
import { createSessionToken } from '../src/backend/core/auth';

async function main() {
  const artifactDir = 'C:\\Users\\SC-RAUF\\.gemini\\antigravity\\brain\\fb5d9e17-9e1f-47b0-bfd2-4e418cc70318';

  const superAdmin = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN', is_active: true } });
  if (!superAdmin) throw new Error('No active SUPER_ADMIN');

  const token = await createSessionToken({
    id: String(superAdmin.id),
    username: superAdmin.username,
    name: superAdmin.full_name || superAdmin.username,
    role: superAdmin.role as any,
    department: superAdmin.department || 'ADMIN',
  } as any);

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies([{ name: 'auth_token', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
  const page = await context.newPage();

  console.log('Navigating to /super-admin/reports?tab=daily...');
  await page.goto('http://localhost:3000/super-admin/reports?tab=daily', { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(2000);

  // Click on "Reports & Governance" in sidebar to expand it if not already expanded
  const reportSidebarBtn = page.locator('button:has-text("Reports & Governan"), button:has-text("Reports & Governance")').first();
  if (await reportSidebarBtn.isVisible().catch(() => false)) {
    const isExpanded = await reportSidebarBtn.getAttribute('aria-expanded');
    if (isExpanded !== 'true') {
      await reportSidebarBtn.click();
      await page.waitForTimeout(1000);
    }
  }

  await page.screenshot({
    path: path.join(artifactDir, 'super_admin_sidebar_expanded.png'),
    fullPage: false,
  });
  console.log('Saved super_admin_sidebar_expanded.png');

  await browser.close();
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
