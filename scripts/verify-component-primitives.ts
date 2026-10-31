import 'dotenv/config';
import { chromium, type Browser } from 'playwright';
import assert from 'node:assert/strict';

const CHROME_PATH = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';

async function runComponentPrimitivesTests() {
  console.log('========================================================================');
  console.log('  ACTUAL REACT COMPONENT PRIMITIVES INTERACTIVE VERIFICATION SUITE');
  console.log('  (Real Component Rendering, Live DOM Interaction, Event Verification)');
  console.log('========================================================================\n');

  let browser: Browser;
  try {
    browser = await chromium.launch({
      executablePath: CHROME_PATH,
      headless: true,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('Chrome path unavailable, using default playwright chromium...', msg);
    browser = await chromium.launch({ headless: true });
  }

  const results: Array<{ name: string; status: 'PASS' | 'FAIL'; error?: string }> = [];

  // 1. Mobile Viewport Context (375x812)
  const mobileCtx = await browser.newContext({
    viewport: { width: 375, height: 812 },
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
  });

  const page = await mobileCtx.newPage();
  await page.goto('http://127.0.0.1:3000/test-primitives', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('h1', { timeout: 8000 });

  // TEST 1: MobileNumberInput actual behaviour
  try {
    const input = page.locator('#test-number-input');
    await input.waitFor({ state: 'visible', timeout: 4000 });

    // a) Verify inputMode="decimal"
    const inputMode = await input.getAttribute('inputmode');
    assert.equal(inputMode, 'decimal', 'Input mode must be decimal for numeric keyboard trigger');

    // b) Verify mobile non-zooming font size >= 16px
    const fontSize = await input.evaluate((el) => parseFloat(window.getComputedStyle(el).fontSize));
    assert(fontSize >= 16, `Font size on mobile must be >= 16px to prevent zoom (got ${fontSize}px)`);

    // c) Initial value
    const initialVal = await input.inputValue();
    assert.equal(initialVal, '4.5', 'Initial value should be 4.5');

    // d) Increment via stepper button (+)
    const plusBtn = page.getByRole('button', { name: 'Increase value' });
    await plusBtn.click();
    const valAfterInc = await input.inputValue();
    assert.equal(valAfterInc, '5', 'Value after increment with 0.5 step should be 5');

    // e) Decrement via stepper button (-)
    const minusBtn = page.getByRole('button', { name: 'Decrease value' });
    await minusBtn.click();
    await minusBtn.click();
    const valAfterDec = await input.inputValue();
    assert.equal(valAfterDec, '4', 'Value after two decrements should be 4');

    // f) Clear button (✕)
    const clearBtn = page.getByRole('button', { name: 'Clear value' });
    assert(await clearBtn.isVisible(), 'Clear button must be visible when value is present');
    await clearBtn.click();
    const valAfterClear = await input.inputValue();
    assert.equal(valAfterClear, '', 'Value after clear must be empty string');

    // g) Max boundary clamping
    await input.fill('20');
    assert(await plusBtn.isDisabled(), 'Increase button must be disabled when value reaches max boundary (20)');

    // h) Min boundary clamping
    await input.fill('0');
    assert(await minusBtn.isDisabled(), 'Decrease button must be disabled when value reaches min boundary (0)');

    console.log('  ✓ [COMPONENT-01] MobileNumberInput (inputMode, font size, steppers, clear, boundaries): PASS');
    results.push({ name: 'MobileNumberInput', status: 'PASS' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('  ✗ [COMPONENT-01] MobileNumberInput: FAIL -', msg);
    results.push({ name: 'MobileNumberInput', status: 'FAIL', error: msg });
  }

  // TEST 2: QuickRemarksChips actual behaviour
  try {
    const chipSpec = page.getByRole('button', { name: /Sample In Spec/i });
    const chipSeal = page.getByRole('button', { name: /Seal Checked/i });
    const textarea = page.locator('textarea[data-testid="remarks-textarea"]');

    // a) Select first chip
    await chipSpec.click();
    assert.equal(await textarea.inputValue(), 'Sample In Spec', 'Textarea should receive chip text');
    assert.equal(await chipSpec.getAttribute('aria-pressed'), 'true', 'Chip should show active pressed state');

    // b) Append second chip
    await chipSeal.click();
    assert.equal(
      await textarea.inputValue(),
      'Sample In Spec, Seal Checked',
      'Second chip should append with comma separator'
    );
    assert.equal(await chipSeal.getAttribute('aria-pressed'), 'true');

    // c) Toggle off first chip
    await chipSpec.click();
    assert.equal(
      await textarea.inputValue(),
      'Seal Checked',
      'Toggling active chip should remove it cleanly without orphan commas'
    );
    assert.equal(await chipSpec.getAttribute('aria-pressed'), 'false');

    console.log('  ✓ [COMPONENT-02] QuickRemarksChips (selection, append, toggle removal): PASS');
    results.push({ name: 'QuickRemarksChips', status: 'PASS' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('  ✗ [COMPONENT-02] QuickRemarksChips: FAIL -', msg);
    results.push({ name: 'QuickRemarksChips', status: 'FAIL', error: msg });
  }

  // TEST 3: CollapsibleDisclosure actual behaviour (Mobile vs Desktop)
  try {
    const disclosureBtn = page.getByRole('button', { name: /SOP Testing Guidelines/i });
    const disclosureContent = page.locator('[data-testid="disclosure-content"]');

    // a) Initially collapsed on mobile
    assert.equal(await disclosureBtn.getAttribute('aria-expanded'), 'false', 'Initially closed on mobile');
    assert(!(await disclosureContent.isVisible()), 'Content should not be visible when collapsed');

    // b) Click to expand
    await disclosureBtn.click();
    assert.equal(await disclosureBtn.getAttribute('aria-expanded'), 'true');
    assert(await disclosureContent.isVisible(), 'Content must be visible after click');

    // c) Click to collapse
    await disclosureBtn.click();
    assert.equal(await disclosureBtn.getAttribute('aria-expanded'), 'false');
    assert(!(await disclosureContent.isVisible()), 'Content must hide when collapsed');

    // d) Desktop force-open behaviour on 1366px
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.waitForTimeout(300);
    assert(
      await disclosureContent.isVisible(),
      'Content must be force-opened and visible on desktop regardless of toggle'
    );

    // Reset back to mobile viewport
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(300);

    console.log('  ✓ [COMPONENT-03] CollapsibleDisclosure (mobile collapse/expand, desktop force-open): PASS');
    results.push({ name: 'CollapsibleDisclosure', status: 'PASS' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('  ✗ [COMPONENT-03] CollapsibleDisclosure: FAIL -', msg);
    results.push({ name: 'CollapsibleDisclosure', status: 'FAIL', error: msg });
  }

  // TEST 4: Drawer actual opening, closing and escape dismissal
  try {
    const openDrawerBtn = page.locator('[data-testid="open-drawer-btn"]');
    await openDrawerBtn.click();

    const drawerDialog = page.locator('[role="dialog"]').first();
    await drawerDialog.waitFor({ state: 'visible', timeout: 4000 });
    assert(await drawerDialog.isVisible(), 'Drawer dialog must be visible after clicking open button');

    // a) Close via Escape key
    await page.keyboard.press('Escape');
    await drawerDialog.waitFor({ state: 'hidden', timeout: 4000 });
    assert(!(await drawerDialog.isVisible()), 'Drawer must be hidden after pressing Escape');
    await page.waitForTimeout(150);
    const isFocusRestoredOnEscape = await openDrawerBtn.evaluate((el) => el === document.activeElement);
    assert(isFocusRestoredOnEscape, 'Focus must be restored to trigger button after Escape dismissal');

    // b) Open again and close via close button
    await openDrawerBtn.click();
    await drawerDialog.waitFor({ state: 'visible', timeout: 4000 });
    const closeBtn = page.locator('[data-testid="close-drawer-btn"]');
    await closeBtn.click();
    await drawerDialog.waitFor({ state: 'hidden', timeout: 4000 });
    assert(!(await drawerDialog.isVisible()), 'Drawer must be hidden after clicking close button');
    await page.waitForTimeout(150);
    const isFocusRestoredOnClose = await openDrawerBtn.evaluate((el) => el === document.activeElement);
    assert(isFocusRestoredOnClose, 'Focus must be restored to trigger button after close button click');

    console.log('  ✓ [COMPONENT-04] Drawer (open, Escape dismiss, close button dismiss, focus restored): PASS');
    results.push({ name: 'Drawer', status: 'PASS' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('  ✗ [COMPONENT-04] Drawer: FAIL -', msg);
    results.push({ name: 'Drawer', status: 'FAIL', error: msg });
  }

  // TEST 5: TableWrapper horizontal scroll containment
  try {
    const tableWrapper = page.locator('[data-table-wrapper]');
    await tableWrapper.waitFor({ state: 'visible', timeout: 4000 });

    const tableMetrics = await tableWrapper.evaluate((container) => {
      const scrollWidth = container.scrollWidth;
      const clientWidth = container.clientWidth;
      const initialScroll = container.scrollLeft;
      container.scrollLeft = 80;
      const didScroll = container.scrollLeft > 0;
      container.scrollLeft = initialScroll;

      const docScrollWidth = document.documentElement.scrollWidth;
      const winWidth = window.innerWidth;

      return {
        isScrollable: scrollWidth > clientWidth,
        canScroll: didScroll,
        noDocOverflow: docScrollWidth <= winWidth + 1,
      };
    });

    assert(tableMetrics.isScrollable, 'Table inside TableWrapper must have scrollWidth > clientWidth on mobile');
    assert(tableMetrics.canScroll, 'TableWrapper container must scroll horizontally');
    assert(tableMetrics.noDocOverflow, 'Document must not have horizontal overflow');

    console.log('  ✓ [COMPONENT-05] TableWrapper (internal scrolling, scroll containment, no page overflow): PASS');
    results.push({ name: 'TableWrapper', status: 'PASS' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('  ✗ [COMPONENT-05] TableWrapper: FAIL -', msg);
    results.push({ name: 'TableWrapper', status: 'FAIL', error: msg });
  }

  // TEST 6: StickyActionBar mobile fixed vs desktop relative positioning
  try {
    const actionBtn = page.locator('[data-testid="action-bar-btn"]');
    await actionBtn.waitFor({ state: 'visible', timeout: 4000 });

    // a) Mobile fixed position
    const mobilePos = await actionBtn.evaluate((el) => {
      const bar = el.closest('div[class*="fixed"]');
      return Boolean(bar);
    });
    assert(mobilePos, 'StickyActionBar must be fixed at bottom on mobile viewport');

    // b) Action button click works
    await actionBtn.click();
    assert.equal(await actionBtn.innerText(), 'Confirm Action (1)', 'Action button must be clickable');

    // c) Desktop relative position
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.waitForTimeout(300);
    const desktopPos = await actionBtn.evaluate((el) => {
      const parent = el.parentElement?.parentElement;
      if (!parent) return false;
      const style = window.getComputedStyle(parent);
      return style.position === 'relative' || style.position === 'static';
    });
    assert(desktopPos, 'StickyActionBar must revert to relative positioning on desktop');

    console.log('  ✓ [COMPONENT-06] StickyActionBar (mobile fixed bar, click handler, desktop relative revert): PASS');
    results.push({ name: 'StickyActionBar', status: 'PASS' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('  ✗ [COMPONENT-06] StickyActionBar: FAIL -', msg);
    results.push({ name: 'StickyActionBar', status: 'FAIL', error: msg });
  }

  await page.close();
  await mobileCtx.close();
  await browser.close();

  const total = results.length;
  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;

  console.log('\n========================================================================');
  console.log(`  COMPONENT PRIMITIVES VERIFICATION SUMMARY:`);
  console.log(`  Total Components Tested: ${total}`);
  console.log(`  PASSED:                  ${passed} (${Math.round((passed / total) * 100)}%)`);
  console.log(`  FAILED:                  ${failed}`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runComponentPrimitivesTests().catch((err) => {
  console.error('Fatal execution error in component primitives test:', err);
  process.exit(1);
});
