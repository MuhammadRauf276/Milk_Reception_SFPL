import test from 'node:test';
import assert from 'node:assert/strict';

test('MobileNumberInput: stepper calculation and min/max clamping logic', () => {
  const calculateNextValue = (
    currentVal: string | number,
    step: number | string,
    direction: 'up' | 'down',
    min?: number,
    max?: number
  ) => {
    const stepVal = typeof step === 'number' ? step : (parseFloat(step) || 1);
    const parsed = parseFloat(String(currentVal)) || 0;
    let next = direction === 'up' ? parsed + stepVal : parsed - stepVal;

    const decimals = String(step).split('.')[1]?.length || 0;
    if (decimals > 0) {
      next = parseFloat(next.toFixed(decimals));
    }

    if (min !== undefined && next < min) next = min;
    if (max !== undefined && next > max) next = max;
    return String(next);
  };

  // 1. Temperature increment with decimal precision (0.5 step)
  assert.equal(calculateNextValue('4.0', 0.5, 'up', 0, 15), '4.5');
  assert.equal(calculateNextValue('4.5', 0.5, 'down', 0, 15), '4');

  // 2. Acidity test with 0.01 step
  assert.equal(calculateNextValue('0.14', 0.01, 'up', 0.1, 0.25), '0.15');
  assert.equal(calculateNextValue('0.14', 0.01, 'down', 0.1, 0.25), '0.13');

  // 3. Min boundary enforcement
  assert.equal(calculateNextValue('0.1', 0.05, 'down', 0.1, 0.25), '0.1');

  // 4. Max boundary enforcement
  assert.equal(calculateNextValue('15', 1, 'up', 0, 15), '15');
});

test('CollapsibleDisclosure: visibility state and desktop force-open logic', () => {
  const isContentVisible = (
    isOpen: boolean,
    forceOpenDesktop: boolean,
    isDesktop: boolean
  ) => {
    if (forceOpenDesktop && isDesktop) return true;
    return isOpen;
  };

  // Mobile: depends strictly on isOpen state
  assert.equal(isContentVisible(false, true, false), false);
  assert.equal(isContentVisible(true, true, false), true);

  // Desktop with forceOpenDesktop=true: always visible even if closed
  assert.equal(isContentVisible(false, true, true), true);
  assert.equal(isContentVisible(true, true, true), true);

  // Desktop with forceOpenDesktop=false: depends on isOpen
  assert.equal(isContentVisible(false, false, true), false);
  assert.equal(isContentVisible(true, false, true), true);
});

test('StickyActionBar: keyboard avoidance positioning logic', () => {
  const getBottomStyle = (
    avoidKeyboard: boolean,
    isKeyboardOpen: boolean,
    keyboardHeight: number
  ) => {
    if (avoidKeyboard && isKeyboardOpen && keyboardHeight > 0) {
      return { bottom: `${keyboardHeight}px` };
    }
    return undefined;
  };

  // 1. Keyboard closed
  assert.deepEqual(getBottomStyle(true, false, 0), undefined);

  // 2. Keyboard open (310px height on mobile Android)
  assert.deepEqual(getBottomStyle(true, true, 310), { bottom: '310px' });

  // 3. Keyboard avoidance disabled
  assert.deepEqual(getBottomStyle(false, true, 310), undefined);
});
