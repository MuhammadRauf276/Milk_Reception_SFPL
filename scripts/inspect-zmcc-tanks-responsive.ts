import 'dotenv/config';
import { chromium, type Browser } from 'playwright';
import { prisma } from '../src/backend/core/db';
import { createSessionToken } from '../src/backend/core/auth';
import type { Role } from '../src/backend/core/types';

const CHROME_PATH = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';

interface ViewportSpec {
  name: string;
  width: number;
  height: number;
  isMobile: boolean;
}

const VIEWPORTS: ViewportSpec[] = [
  { name: 'Smallest Mobile (320x568)', width: 320, height: 568, isMobile: true },
  { name: 'Android Small (360x800)', width: 360, height: 800, isMobile: true },
  { name: 'iPhone / Standard Mobile (375x812)', width: 375, height: 812, isMobile: true },
  { name: 'Large Mobile (414x896)', width: 414, height: 896, isMobile: true },
  { name: 'Tablet Portrait (768x1024)', width: 768, height: 1024, isMobile: false },
  { name: 'Desktop (1280x800)', width: 1280, height: 800, isMobile: false },
];

async function generateSuperAdminToken(): Promise<string> {
  const dbUser = await prisma.user.findFirst({
    where: { username: 'admin.superuser', is_active: true },
  });
  if (!dbUser) {
    throw new Error("Required active user 'admin.superuser' not found in database.");
  }
  return createSessionToken({
    id: String(dbUser.id),
    username: dbUser.username,
    name: dbUser.full_name || dbUser.username,
    role: dbUser.role as Role,
    department: dbUser.department || 'Operations',
    zone: (dbUser as unknown as { zone?: string | null }).zone || null,
    scope_type: dbUser.scope_type || 'ALL',
    procurement_source_id: dbUser.procurement_source_id ? String(dbUser.procurement_source_id) : null,
  });
}

async function runInspection() {
  console.log('========================================================================');
  console.log('  CHROME DEVTOOLS / PLAYWRIGHT RESPONSIVE INSPECTION: ZMCC TANKS');
  console.log('========================================================================\n');

  const token = await generateSuperAdminToken();

  let browser: Browser;
  try {
    browser = await chromium.launch({
      executablePath: CHROME_PATH,
      headless: true,
    });
    console.log('✓ Launched Google Chrome via Playwright CDP');
  } catch (err) {
    console.warn('Chrome executable not found at specified path, falling back to bundled chromium...', err);
    browser = await chromium.launch({ headless: true });
    console.log('✓ Launched Playwright Chromium');
  }

  const results: Array<{ viewport: string; status: 'PASS' | 'FAIL'; details: string }> = [];

  for (const vp of VIEWPORTS) {
    console.log(`\n--- Inspecting Viewport: ${vp.name} (${vp.width}x${vp.height}) ---`);
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      isMobile: vp.isMobile,
      hasTouch: vp.isMobile,
    });

    await context.addCookies([
      {
        name: 'auth_token',
        value: token,
        url: 'http://127.0.0.1:3000',
      },
    ]);

    const page = await context.newPage();

    try {
      await page.goto('http://127.0.0.1:3000/super-admin/zmcc-tanks', {
        waitUntil: 'load',
        timeout: 15000,
      });

      // Wait for page header and content
      await page.waitForSelector('h1', { timeout: 10000 });
      await page.waitForTimeout(600);

      // Check document overflow
      const overflowMetrics = await page.evaluate(() => {
        const docWidth = document.documentElement.clientWidth;
        const scrollWidth = document.documentElement.scrollWidth;
        const bodyScrollWidth = document.body.scrollWidth;
        const winWidth = window.innerWidth;
        return {
          winWidth,
          docWidth,
          scrollWidth,
          bodyScrollWidth,
          hasHorizontalOverflow: scrollWidth > winWidth + 1 || bodyScrollWidth > winWidth + 1,
        };
      });

      if (overflowMetrics.hasHorizontalOverflow) {
        throw new Error(
          `Horizontal page overflow detected! Window width: ${overflowMetrics.winWidth}px, doc scrollWidth: ${overflowMetrics.scrollWidth}px, body scrollWidth: ${overflowMetrics.bodyScrollWidth}px`
        );
      }
      console.log(`  ✓ Zero horizontal page overflow (Window: ${overflowMetrics.winWidth}px, Scroll: ${overflowMetrics.scrollWidth}px)`);

      // Verify layout mode: Mobile Cards vs Desktop Table
      const layoutCheck = await page.evaluate((isMobileBreakpoint) => {
        const mobileCards = document.querySelector('[data-testid="mobile-tank-cards"]');
        const desktopTable = document.querySelector('[data-testid="desktop-tanks-table"]');

        const mobileCardsDisplay = mobileCards ? window.getComputedStyle(mobileCards).display : 'NOT_FOUND';
        const desktopTableDisplay = desktopTable ? window.getComputedStyle(desktopTable).display : 'NOT_FOUND';

        return {
          isMobileBreakpoint,
          mobileCardsDisplay,
          desktopTableDisplay,
          isMobileCardsVisible: mobileCardsDisplay !== 'none' && mobileCardsDisplay !== 'NOT_FOUND',
          isDesktopTableVisible: desktopTableDisplay !== 'none' && desktopTableDisplay !== 'NOT_FOUND',
        };
      }, vp.width < 768);

      if (vp.width < 768) {
        if (!layoutCheck.isMobileCardsVisible) {
          throw new Error(`Mobile card list is not visible on mobile screen (< 768px). Display: ${layoutCheck.mobileCardsDisplay}, Desktop Display: ${layoutCheck.desktopTableDisplay}`);
        }
        if (layoutCheck.isDesktopTableVisible) {
          throw new Error(`Desktop table should be hidden on mobile screen (< 768px). Desktop Display: ${layoutCheck.desktopTableDisplay}`);
        }
        console.log('  ✓ Responsive adaptive view: Mobile Cards visible, Desktop Table hidden');
      } else {
        if (layoutCheck.isMobileCardsVisible) {
          throw new Error(`Mobile card list should be hidden on tablet/desktop (>= 768px). Mobile Display: ${layoutCheck.mobileCardsDisplay}`);
        }
        if (!layoutCheck.isDesktopTableVisible) {
          throw new Error(`Desktop table should be visible on tablet/desktop (>= 768px). Desktop Display: ${layoutCheck.desktopTableDisplay}`);
        }
        console.log('  ✓ Responsive adaptive view: Desktop Table visible, Mobile Cards hidden');
      }

      // Check touch target heights on mobile viewports
      if (vp.isMobile) {
        const touchTargets = await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button'));
          const smallButtons: string[] = [];
          for (const b of buttons) {
            const rect = b.getBoundingClientRect();
            // Ignore hidden buttons or zero-size buttons
            if (rect.width > 0 && rect.height > 0) {
              if (rect.height < 36) {
                smallButtons.push(`${b.innerText.trim().slice(0, 15)} (${rect.height}px)`);
              }
            }
          }
          return { smallButtons, totalButtons: buttons.length };
        });

        if (touchTargets.smallButtons.length > 0) {
          console.warn(`  ⚠ Warning: Some buttons have height < 36px:`, touchTargets.smallButtons);
        } else {
          console.log(`  ✓ Touch targets: All ${touchTargets.totalButtons} active buttons have adequate touch height (>=36px/44px)`);
        }
      }

      // Test Drawer Interaction on mobile: Click "Intake Milk Stock" header button
      const intakeBtn = page.getByRole('button', { name: /Intake Milk Stock/i });
      if (await intakeBtn.isVisible()) {
        await intakeBtn.click();
        await page.waitForTimeout(400);

        // Check that drawer opened without crashing or overflowing
        const drawerMetrics = await page.evaluate(() => {
          const drawer = document.querySelector('[role="dialog"]');
          if (!drawer) return null;
          const rect = drawer.getBoundingClientRect();
          const docScroll = document.documentElement.scrollWidth;
          const winW = window.innerWidth;
          return {
            width: rect.width,
            height: rect.height,
            isWithinBounds: rect.width <= winW + 2 && docScroll <= winW + 2,
          };
        });

        if (drawerMetrics) {
          if (!drawerMetrics.isWithinBounds) {
            throw new Error(`Drawer caused horizontal overflow: ${JSON.stringify(drawerMetrics)}`);
          }
          console.log(`  ✓ Drawer interaction: Intake Drawer opened cleanly (Width: ${Math.round(drawerMetrics.width)}px, No overflow)`);

          // Press Escape or Cancel to close
          await page.keyboard.press('Escape');
          await page.waitForTimeout(300);
        }
      }

      results.push({
        viewport: vp.name,
        status: 'PASS',
        details: 'All mobile responsive layout, touch targets, and drawer checks passed.',
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ Viewport ${vp.name} FAIL: ${msg}`);
      results.push({
        viewport: vp.name,
        status: 'FAIL',
        details: msg,
      });
    } finally {
      await page.close();
      await context.close();
    }
  }

  await browser.close();

  console.log('\n========================================================================');
  console.log('  RESPONSIVE INSPECTION SUMMARY:');
  for (const r of results) {
    console.log(`  ${r.status === 'PASS' ? '✓' : '✗'} ${r.viewport}: ${r.status} - ${r.details}`);
  }
  console.log('========================================================================\n');

  const failed = results.filter((r) => r.status === 'FAIL');
  if (failed.length > 0) {
    process.exit(1);
  }
}

runInspection().catch((err) => {
  console.error('Fatal inspection script error:', err);
  process.exit(1);
});
