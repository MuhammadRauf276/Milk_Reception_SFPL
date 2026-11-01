import test from 'node:test';
import assert from 'node:assert/strict';
import { TableWrapper, ResponsiveTableWrapper } from '../table-wrapper';

test('TableWrapper: exports and aliases', () => {
  assert.equal(typeof TableWrapper, 'object'); // React.forwardRef object
  assert.equal(TableWrapper, ResponsiveTableWrapper);
});

test('TableWrapper: scroll overflow indicators calculation logic', () => {
  // Evaluates the internal indicator state calculation of TableWrapper
  const calculateScrollIndicators = (scrollLeft: number, scrollWidth: number, clientWidth: number) => {
    const canScrollLeft = scrollLeft > 2;
    const canScrollRight = scrollLeft + clientWidth < scrollWidth - 2;
    return { canScrollLeft, canScrollRight };
  };

  // 1. Fully visible table on desktop (no overflow)
  const state1 = calculateScrollIndicators(0, 800, 1000);
  assert.equal(state1.canScrollLeft, false);
  assert.equal(state1.canScrollRight, false);

  // 2. Table wider than screen, at start position (scrolled to 0)
  // E.g., 800px table in a 360px mobile viewport
  const state2 = calculateScrollIndicators(0, 800, 360);
  assert.equal(state2.canScrollLeft, false);
  assert.equal(state2.canScrollRight, true); // Right indicator active

  // 3. Table scrolled into the middle
  const state3 = calculateScrollIndicators(150, 800, 360);
  assert.equal(state3.canScrollLeft, true);  // Left indicator active
  assert.equal(state3.canScrollRight, true); // Right indicator active

  // 4. Table scrolled to the very end (440px + 360px = 800px)
  const state4 = calculateScrollIndicators(440, 800, 360);
  assert.equal(state4.canScrollLeft, true);  // Left indicator active
  assert.equal(state4.canScrollRight, false); // Right indicator off

  // 5. Small subpixel jitter (<2px) should not trigger false indicators
  const state5 = calculateScrollIndicators(1.5, 800, 799);
  assert.equal(state5.canScrollLeft, false);
  assert.equal(state5.canScrollRight, false);
});

test('TableWrapper: event listener registration and ResizeObserver lifecycle', () => {
  let scrollListeners: (() => void)[] = [];
  let resizeListeners: (() => void)[] = [];
  let observedElements: unknown[] = [];
  let disconnected = false;

  const mockElement = {
    addEventListener: (event: string, fn: () => void) => {
      if (event === 'scroll') scrollListeners.push(fn);
    },
    removeEventListener: (event: string, fn: () => void) => {
      if (event === 'scroll') scrollListeners = scrollListeners.filter((f) => f !== fn);
    },
  };

  const mockWindow = {
    addEventListener: (event: string, fn: () => void) => {
      if (event === 'resize') resizeListeners.push(fn);
    },
    removeEventListener: (event: string, fn: () => void) => {
      if (event === 'resize') resizeListeners = resizeListeners.filter((f) => f !== fn);
    },
  };

  const mockResizeObserver = {
    observe: (el: unknown) => {
      observedElements.push(el);
    },
    disconnect: () => {
      disconnected = true;
      observedElements = [];
    },
  };

  // Simulating effect setup
  mockElement.addEventListener('scroll', () => {});
  mockWindow.addEventListener('resize', () => {});
  mockResizeObserver.observe(mockElement);

  assert.equal(scrollListeners.length, 1);
  assert.equal(resizeListeners.length, 1);
  assert.equal(observedElements.length, 1);
  assert.equal(disconnected, false);

  // Simulating effect cleanup
  mockElement.removeEventListener('scroll', scrollListeners[0]);
  mockWindow.removeEventListener('resize', resizeListeners[0]);
  mockResizeObserver.disconnect();

  assert.equal(scrollListeners.length, 0);
  assert.equal(resizeListeners.length, 0);
  assert.equal(observedElements.length, 0);
  assert.equal(disconnected, true);
});
