import 'dotenv/config';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import path from 'node:path';
import { prisma } from '../src/backend/core/db';
import { createSessionToken } from '../src/backend/core/auth';
import type { Role } from '../src/backend/core/types';

const CHROME_PATH = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const BASE_URL = 'http://127.0.0.1:3000';
const OUTPUT_DIR = 'C:\\Users\\SC-RAUF\\.gemini\\antigravity\\brain\\63b7fe61-c17a-432c-afb1-98ff93923ce9\\screenshots';

async function generateToken(username: string): Promise<{ token: string; user: any }> {
  const dbUser = await prisma.user.findFirstOrThrow({
    where: { username, is_active: true },
  });
  const token = await createSessionToken({
    id: String(dbUser.id),
    username: dbUser.username,
    name: dbUser.full_name || dbUser.username,
    role: dbUser.role as Role,
    department: dbUser.department || 'Operations',
    zone: (dbUser as any).zone || null,
    scope_type: dbUser.scope_type || 'ALL',
    procurement_source_id: dbUser.procurement_source_id ? String(dbUser.procurement_source_id) : null,
  });
  return { token, user: dbUser };
}

async function createContextWithAuth(browser: Browser, token: string, isMobile = false): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: isMobile ? { width: 412, height: 915 } : { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    isMobile,
  });

  await context.addCookies([
    {
      name: 'auth_token',
      value: token,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
    {
      name: 'session_token',
      value: token,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);

  return context;
}

async function run() {
  console.log('Launching Chrome from:', CHROME_PATH);
  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
  });

  try {
    const prodHead = await generateToken('production.head');
    console.log('Production Head auth generated:', prodHead.user.username);

    // Desktop Context
    const desktopContext = await createContextWithAuth(browser, prodHead.token, false);
    const desktopPage = await desktopContext.newPage();

    // 1. Silo Unloading Operator Page showing Supervisor Banner
    console.log('Navigating to Silo Reception in Operator mode...');
    await desktopPage.goto(`${BASE_URL}/department/production`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await desktopPage.waitForSelector('text=Supervisor Oversight', { timeout: 15000 });
    await desktopPage.waitForTimeout(2000);
    const p5 = path.join(OUTPUT_DIR, '12-production-operator-supervisor-banner.png');
    await desktopPage.screenshot({ path: p5, fullPage: true });
    console.log('Saved:', p5);

    await desktopContext.close();

    // Mobile / Tablet Context for Hamburger Navigation Drawer
    console.log('Opening Mobile context to show Navigation Drawer...');
    const mobileContext = await createContextWithAuth(browser, prodHead.token, true);
    const mobilePage = await mobileContext.newPage();

    await mobilePage.goto(`${BASE_URL}/department/production-head`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await mobilePage.waitForSelector('text=Production Command', { timeout: 15000 });
    await mobilePage.waitForTimeout(1000);

    const menuBtn = mobilePage.locator('button[aria-label*="menu" i], button:has(svg.lucide-menu)');
    if (await menuBtn.count() > 0) {
      await menuBtn.first().click();
      await mobilePage.waitForTimeout(1500);
      const p4 = path.join(OUTPUT_DIR, '11-production-head-nav-drawer.png');
      await mobilePage.screenshot({ path: p4 });
      console.log('Saved:', p4);
    }

    await mobileContext.close();
    console.log('All remaining screenshots captured successfully!');
  } finally {
    await browser.close();
    await prisma.$disconnect();
  }
}

run().catch((e) => {
  console.error('Fatal execution error:', e);
  process.exit(1);
});
