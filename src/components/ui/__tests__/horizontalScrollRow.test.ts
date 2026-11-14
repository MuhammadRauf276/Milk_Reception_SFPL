import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HorizontalScrollRow,
  calculateHorizontalScrollOverflow,
} from '../horizontal-scroll-row';

test('HorizontalScrollRow: exports forwardRef component and overflow helper', () => {
  assert.equal(typeof HorizontalScrollRow, 'object');
  assert.equal(typeof calculateHorizontalScrollOverflow, 'function');
});

test('HorizontalScrollRow: overflow indicator calculation handles card widths cleanly', () => {
  // 1. All items fit comfortably inside a wide card
  assert.deepEqual(calculateHorizontalScrollOverflow(0, 560, 600), {
    canScrollLeft: false,
    canScrollRight: false,
  });

  // 2. 7-stage lifecycle track (~812px) inside a compact 320px desktop grid card at scrollLeft=0
  assert.deepEqual(calculateHorizontalScrollOverflow(0, 812, 320), {
    canScrollLeft: false,
    canScrollRight: true,
  });

  // 3. Scrolled midway along the row
  assert.deepEqual(calculateHorizontalScrollOverflow(220, 812, 320), {
    canScrollLeft: true,
    canScrollRight: true,
  });

  // 4. Scrolled to the right edge (492 + 320 = 812)
  assert.deepEqual(calculateHorizontalScrollOverflow(492, 812, 320), {
    canScrollLeft: true,
    canScrollRight: false,
  });

  // 5. Subpixel rounding jitter (<2px) does not falsely activate fades
  assert.deepEqual(calculateHorizontalScrollOverflow(1.5, 500, 499), {
    canScrollLeft: false,
    canScrollRight: false,
  });
});
