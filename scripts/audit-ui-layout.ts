/**
 * Layout audit for every main screen, across phone and desktop widths.
 *
 * Reports what a page-level overflow check cannot see, because the app hides
 * horizontal overflow on the body:
 *   - elements pushed past the viewport
 *   - icons that leave the card around them
 *   - numbers and codes cut off with an ellipsis
 *   - text under 12px and touch targets under 36px
 *
 * Safe to run: it never signs anyone in with a password, and it aborts every
 * non-GET request, so no click in this script can change data.
 *
 * Usage: npm run test:layout -- [outDir] [--quick]
 * Exit code 1 when a blocking problem is found.
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';
import { prisma } from '../src/backend/core/db';
import { createSessionToken } from '../src/backend/core/auth';
import type { Role } from '../src/backend/core/types';

const BASE = process.env.AUDIT_BASE_URL || 'http://127.0.0.1:3000';
const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
const OUT = args.find((a) => !a.startsWith('--')) || 'artifacts/ui-layout-audit';
const CHROME_PATH = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';

const WIDTHS = QUICK
  ? [[320, 568], [360, 800], [1366, 768]]
  : [[280, 653], [320, 568], [360, 800], [390, 844], [412, 915], [768, 1024], [1024, 768], [1366, 768], [1536, 864], [1920, 1080], [2560, 1440]];

const SA = 'admin.superuser';
const ZM = 'zmcc.manager.hasilpur';
const SCREENS: [id: string, path: string, username: string][] = [
  ['login', '/login', ''],
  ['device-setup', '/device-setup', ''],
  ['mot', '/mot', 'mot.driver'],
  ['phe', '/phe', 'phe.operator'],
  ['phe-exit', '/phe?section=exit', 'phe.operator'],
  ['mdo', '/phe', 'mdo.hasilpur'],
  ['zmcc-lab', '/zmcc/lab', 'zmcc.operator'],
  ['security', '/department/security', 'security.gate'],
  ['weighbridge', '/department/weighbridge', 'weighbridge.operator'],
  ['weighbridge-2', '/department/weighbridge?tab=SECOND_WEIGHT', 'weighbridge.operator'],
  ['qa', '/department/qa', 'qa.reception@shakarganj.com.pk'],
  ['qa-testing', '/department/qa?tab=IN_TESTING', 'qa.reception@shakarganj.com.pk'],
  ['qa-head', '/department/qa-head', 'qa.head@shakarganj.com.pk'],
  ['production', '/department/production', 'production.operator'],
  ['production-head', '/department/production-head', 'production.head'],
  ['contractor-mgr', '/contractor/manager', 'contractor.manager.alkhair'],
  ['zm-overview', '/mpd/zmcc-manager?tab=OVERVIEW', ZM],
  ['zm-approvals', '/mpd/zmcc-manager?tab=APPROVALS', ZM],
  ['zm-transit', '/mpd/zmcc-manager?tab=PLANT_TRANSIT', ZM],
  ['zm-live', '/mpd/zmcc-manager?tab=LIVE', ZM],
  ['command', '/command', 'mpd.head'],
  ['sources', '/sources', 'mpd.head'],
  ['approvals', '/approvals', 'admin.head'],
  ['my-requests', '/my-requests', 'zmcc.operator'],
  ['tv-board', '/tv-board', SA],
  ['affiliates', '/affiliates', SA],
  ['sa-home', '/super-admin', SA],
  ['sa-users', '/super-admin/users', SA],
  ['sa-sources', '/super-admin/procurement-sources', SA],
  ['sa-audit', '/super-admin/audit', SA],
  ['sa-daily', '/super-admin/daily-report', SA],
  ['sa-reports', '/super-admin/reports', SA],
  ['sa-tanks', '/super-admin/zmcc-tanks', SA],
  ['sa-silos', '/super-admin/silos', SA],
  ['sa-corrections', '/super-admin/corrections', SA],
  ['sa-fleet', '/super-admin/fleet', SA],
  ['sa-mot', '/super-admin/mot-operations', SA],
  ['sa-operations', '/super-admin/operations', SA],
  ['sa-hierarchy', '/super-admin/hierarchy-work', SA],
  ['sa-lab', '/super-admin/lab-tests', SA],
  ['sa-devices', '/super-admin/devices', SA],
  ['sa-settings', '/super-admin/settings', SA],
  ['sa-whatsapp', '/super-admin/whatsapp', SA],
  ['sa-master', '/super-admin/master-data', SA],
  ['sa-zmcc-master', '/super-admin/zmcc-master-data', SA],
  ['sa-sop', '/super-admin/sop-rules', SA],
  ['sa-test-policies', '/super-admin/test-policies', SA],
  ['sa-weighing', '/super-admin/weighing-policy', SA],
];

interface Metrics {
  pageOverflow: number;
  escaped: string[];
  iconsOut: string[];
  clippedFigures: string[];
  smallText: number;
  tinyTargets: number;
  dialogOpen: boolean;
}

/** Runs in the browser. Kept as a string so the compiler cannot add helpers to it. */
const MEASURE = `(() => {
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const label = (e) => e.tagName.toLowerCase() + '.' + String(e.getAttribute('class') || '').slice(0, 90);
  const scroller = (e, stop) => {
    for (let p = e.parentElement; p && p !== stop; p = p.parentElement) {
      if (p === document.body || p === document.documentElement) return false;
      const o = getComputedStyle(p).overflowX;
      if (o === 'auto' || o === 'scroll') return true;
    }
    return false;
  };
  const dialog = document.querySelector('[role="dialog"], [data-vaul-drawer]');
  const root = dialog || document.body;
  const shown = (r) => r.width > 0 && r.height > 0;
  const hidden = (e) => { const s = getComputedStyle(e); return s.visibility === 'hidden' || s.opacity === '0'; };
  const escaped = [];
  root.querySelectorAll('*').forEach((e) => {
    if (e.closest('.maplibregl-map,[data-sonner-toaster],nextjs-portal,[data-nextjs-toast]')) return;
    const r = e.getBoundingClientRect();
    if (shown(r) && !hidden(e) && (r.right > vw + 1 || r.left < -1) && !scroller(e) && getComputedStyle(e).position !== 'fixed') escaped.push(label(e) + ' x=' + Math.round(r.left) + '..' + Math.round(r.right));
  });
  const iconsOut = [];
  root.querySelectorAll('svg').forEach((s) => {
    const r = s.getBoundingClientRect();
    if (!shown(r) || r.width > 48 || s.closest('.maplibregl-map')) return;
    const box = s.parentElement && s.parentElement.closest('[class*="border"], button, a');
    if (!box) return;
    const c = box.getBoundingClientRect();
    if (scroller(s, box)) return;
    const over = Math.max(r.right - c.right, c.left - r.left, r.bottom - c.bottom, c.top - r.top);
    if (over > 1) iconsOut.push(label(box) + ' by=' + Math.round(over));
  });
  const clippedFigures = [];
  let smallText = 0;
  root.querySelectorAll('p,span,div,td,th,h1,h2,h3,h4,button,a,label,strong').forEach((e) => {
    if (!e.offsetWidth) return;
    const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own) return;
    const s = getComputedStyle(e);
    if (parseFloat(s.fontSize) < 12) smallText++;
    if (e.scrollWidth > e.clientWidth + 1 && (s.overflowX === 'hidden' || s.overflowX === 'clip') && /\\d/.test(e.textContent)) {
      clippedFigures.push(e.textContent.trim().slice(0, 40));
    }
  });
  let tinyTargets = 0;
  root.querySelectorAll('button,a[href],input:not([type=hidden]),select').forEach((e) => {
    const r = e.getBoundingClientRect();
    if (shown(r) && (r.height < 36 || r.width < 36)) tinyTargets++;
  });
  const uniq = (a) => [...new Set(a)];
  return {
    pageOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - vw,
    escaped: uniq(escaped), iconsOut: uniq(iconsOut), clippedFigures: uniq(clippedFigures),
    smallText, tinyTargets, dialogOpen: !!dialog,
  };
})()`;

/** Opens the first detail or create dialog on a screen. Writes are blocked by the route guard. */
async function openFirstDialog(page: Page): Promise<boolean> {
  const candidate = page
    .locator('main button, main [role="button"]')
    .filter({ hasText: /review|inspect|open|view|details|add|new|create|record|weigh|enter|start|test/i })
    .first();
  if (!(await candidate.count())) return false;
  await candidate.click({ timeout: 2500 }).catch(() => {});
  await page.waitForTimeout(600);
  return (await page.locator('[role="dialog"], [data-vaul-drawer]').count()) > 0;
}

async function token(username: string): Promise<string | null> {
  const u = await prisma.user.findFirst({ where: { username, is_active: true } });
  if (!u) return null;
  return createSessionToken({
    id: String(u.id),
    username: u.username,
    name: u.full_name || u.username,
    role: u.role as Role,
    department: u.department || 'Operations',
    zone: null,
    scope_type: u.scope_type || 'ALL',
    procurement_source_id: u.procurement_source_id ? String(u.procurement_source_id) : null,
  });
}

async function main() {
  mkdirSync(`${OUT}/shots`, { recursive: true });
  const browser: Browser = await chromium
    .launch({ headless: true, executablePath: CHROME_PATH })
    .catch(() => chromium.launch({ headless: true }));
  const tokens = new Map<string, string | null>();
  const rows: Record<string, unknown>[] = [];

  for (const [id, path, username] of SCREENS) {
    if (username && !tokens.has(username)) tokens.set(username, await token(username));
    if (username && !tokens.get(username)) {
      rows.push({ id, skipped: `no active user ${username}` });
      console.log(`- ${id}: skipped, no active user ${username}`);
      continue;
    }
    for (const [width, height] of WIDTHS) {
      const modes = width === 360 ? ['base', 'large-text', 'dialog'] : width === 1366 ? ['base', 'dialog'] : ['base'];
      for (const mode of modes) {
        const ctx = await browser.newContext({ viewport: { width, height }, isMobile: width < 768, hasTouch: width < 768 });
        await ctx.route('**/*', (r) => (r.request().method() === 'GET' ? r.continue() : r.abort()));
        if (username) await ctx.addCookies([{ name: 'auth_token', value: tokens.get(username)!, url: BASE }]);
        const page = await ctx.newPage();
        try {
          await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 60000 });
          await page.waitForSelector('[role="status"]', { state: 'detached', timeout: 8000 }).catch(() => {});
          await page.waitForTimeout(700);
          if (mode === 'large-text') {
            await page.addStyleTag({ content: 'html{font-size:125%!important}' });
            await page.waitForTimeout(200);
          }
          if (mode === 'dialog' && !(await openFirstDialog(page))) {
            await ctx.close();
            continue;
          }
          const m = (await page.evaluate(MEASURE)) as Metrics;
          rows.push({ id, path, width, mode, finalUrl: page.url().replace(BASE, ''), ...m });
          if (mode !== 'base' || width === 360 || width === 1366) {
            await page.screenshot({ path: `${OUT}/shots/${id}-${width}-${mode}.png` });
          }
          const bad = m.pageOverflow > 0 || m.escaped.length || m.iconsOut.length || m.clippedFigures.length;
          if (bad) {
            console.log(`x ${id} ${width} ${mode}: overflow=${m.pageOverflow} escaped=${m.escaped.length} icons=${m.iconsOut.length} clipped=${m.clippedFigures.length}`);
          }
        } catch (e) {
          rows.push({ id, width, mode, error: String(e).slice(0, 160) });
          console.log(`! ${id} ${width} ${mode}: ${String(e).slice(0, 100)}`);
        }
        await ctx.close();
      }
    }
  }

  writeFileSync(`${OUT}/results.json`, JSON.stringify(rows, null, 1));
  const measured = rows.filter((r) => 'pageOverflow' in r) as unknown as Metrics[];
  const sum = (f: (m: Metrics) => number) => measured.reduce((n, m) => n + f(m), 0);
  const blocking = sum((m) => Math.max(0, m.pageOverflow) + m.escaped.length + m.iconsOut.length);
  console.log(
    `\nChecks ${measured.length} | overflow+escaped ${sum((m) => Math.max(0, m.pageOverflow) + m.escaped.length)} | icons out ${sum((m) => m.iconsOut.length)} | clipped figures ${sum((m) => m.clippedFigures.length)} | small text ${sum((m) => m.smallText)} | tiny targets ${sum((m) => m.tinyTargets)} | errors ${rows.filter((r) => 'error' in r).length}`
  );
  await browser.close();
  await prisma.$disconnect();
  process.exit(blocking > 0 ? 1 : 0);
}

main();
