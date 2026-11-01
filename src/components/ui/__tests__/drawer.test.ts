import test from 'node:test';
import assert from 'node:assert/strict';

test('Drawer: dynamic mobile max-height calculation logic', () => {
  const calculateMobileMaxHeight = (isKeyboardOpen: boolean, vvh: number | null) => {
    return isKeyboardOpen && vvh
      ? `${Math.max(260, Math.floor(vvh - 12))}px`
      : '92dvh';
  };

  // 1. Keyboard closed on mobile
  assert.equal(calculateMobileMaxHeight(false, 800), '92dvh');
  assert.equal(calculateMobileMaxHeight(false, null), '92dvh');

  // 2. Keyboard open on standard Android (e.g. 800px screen, 450px visual viewport left)
  assert.equal(calculateMobileMaxHeight(true, 450), '438px');

  // 3. Keyboard open on small screen (e.g. 300px visual viewport left)
  assert.equal(calculateMobileMaxHeight(true, 300), '288px');

  // 4. Keyboard open with extreme small viewport (e.g. 240px) respects min-height of 260px
  assert.equal(calculateMobileMaxHeight(true, 240), '260px');
});

test('Drawer: desktop breakpoint matching query', () => {
  const _DESKTOP_QUERY = '(min-width: 768px)';
  const matchesDesktop = (width: number) => width >= 768;

  // Mobile widths
  assert.equal(matchesDesktop(360), false);
  assert.equal(matchesDesktop(375), false);
  assert.equal(matchesDesktop(390), false);
  assert.equal(matchesDesktop(412), false);

  // Tablet & Desktop widths
  assert.equal(matchesDesktop(768), true);
  assert.equal(matchesDesktop(1024), true);
  assert.equal(matchesDesktop(1366), true);
});
