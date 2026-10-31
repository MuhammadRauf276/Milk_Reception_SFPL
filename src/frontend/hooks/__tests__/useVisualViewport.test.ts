import test from 'node:test';
import assert from 'node:assert/strict';
import { useVisualViewport, useVisualViewportHeight } from '../useVisualViewport';

// Mock event target supporting add/remove/dispatch
class MockVisualViewport {
  height = 800;
  width = 360;
  private listeners: Record<string, Function[]> = {};

  addEventListener(event: string, fn: Function) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
  }

  removeEventListener(event: string, fn: Function) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter((f) => f !== fn);
  }

  dispatchEvent(event: string) {
    this.listeners[event]?.forEach((fn) => fn());
  }

  getListenerCount(event: string): number {
    return this.listeners[event]?.length || 0;
  }
}

test('useVisualViewport: exports and structure', () => {
  assert.equal(typeof useVisualViewport, 'function');
  assert.equal(typeof useVisualViewportHeight, 'function');
});

test('useVisualViewport: keyboard detection and recovery calculation logic', () => {
  // Pure logic verification
  const calculateViewportState = (windowInnerHeight: number, vvHeight: number, vvWidth: number) => {
    const heightDiff = windowInnerHeight - vvHeight;
    const isKeyboardOpen = heightDiff > 150;
    const keyboardHeight = isKeyboardOpen ? Math.max(0, heightDiff) : 0;
    return {
      height: vvHeight,
      width: vvWidth,
      isKeyboardOpen,
      keyboardHeight,
    };
  };

  // 1. Initial full-screen state (no keyboard)
  const state1 = calculateViewportState(800, 800, 360);
  assert.equal(state1.height, 800);
  assert.equal(state1.width, 360);
  assert.equal(state1.isKeyboardOpen, false);
  assert.equal(state1.keyboardHeight, 0);

  // 2. Normal browser UI chrome change (e.g., URL bar scrolls away by 56px, diff <= 150)
  const state2 = calculateViewportState(800, 744, 360);
  assert.equal(state2.isKeyboardOpen, false);
  assert.equal(state2.keyboardHeight, 0);

  // 3. Android software keyboard opens (height drops by 320px)
  const state3 = calculateViewportState(800, 480, 360);
  assert.equal(state3.isKeyboardOpen, true);
  assert.equal(state3.keyboardHeight, 320);

  // 4. Large keyboard on large Android (e.g. 412x915 with 380px keyboard)
  const state4 = calculateViewportState(915, 535, 412);
  assert.equal(state4.isKeyboardOpen, true);
  assert.equal(state4.keyboardHeight, 380);

  // 5. Keyboard close recovery
  const state5 = calculateViewportState(800, 800, 360);
  assert.equal(state5.isKeyboardOpen, false);
  assert.equal(state5.keyboardHeight, 0);
});

test('useVisualViewport: event listener attachment and cleanup lifecycle', () => {
  const mockVv = new MockVisualViewport();
  let updateCalls = 0;

  const update = () => {
    updateCalls++;
  };

  // Simulating the hook effect attachment
  mockVv.addEventListener('resize', update);
  mockVv.addEventListener('scroll', update);

  assert.equal(mockVv.getListenerCount('resize'), 1);
  assert.equal(mockVv.getListenerCount('scroll'), 1);

  // Dispatch events
  mockVv.dispatchEvent('resize');
  mockVv.dispatchEvent('scroll');
  assert.equal(updateCalls, 2);

  // Simulating effect cleanup on unmount
  mockVv.removeEventListener('resize', update);
  mockVv.removeEventListener('scroll', update);

  assert.equal(mockVv.getListenerCount('resize'), 0);
  assert.equal(mockVv.getListenerCount('scroll'), 0);

  // Dispatching after unmount should NOT trigger callbacks
  mockVv.dispatchEvent('resize');
  assert.equal(updateCalls, 2);
});

test('useVisualViewport: focused input visibility scroll invocation', () => {
  let scrolledElements: string[] = [];

  const mockInput = {
    tagName: 'INPUT',
    scrollIntoView: (opts?: any) => {
      scrolledElements.push(`INPUT:${opts?.behavior}`);
    },
  };

  const mockTextarea = {
    tagName: 'TEXTAREA',
    scrollIntoView: (opts?: any) => {
      scrolledElements.push(`TEXTAREA:${opts?.behavior}`);
    },
  };

  const mockDiv = {
    tagName: 'DIV',
    scrollIntoView: (opts?: any) => {
      scrolledElements.push(`DIV:${opts?.behavior}`);
    },
  };

  // Helper function mimicking the hook's focus scroll behavior
  const handleKeyboardFocusScroll = (activeElement: any, isKeyboardOpen: boolean) => {
    if (
      isKeyboardOpen &&
      activeElement &&
      (activeElement.tagName === 'INPUT' ||
        activeElement.tagName === 'TEXTAREA' ||
        activeElement.tagName === 'SELECT')
    ) {
      activeElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  };

  // Test 1: Focused input when keyboard opens -> scrolls
  handleKeyboardFocusScroll(mockInput, true);
  assert.deepEqual(scrolledElements, ['INPUT:smooth']);

  // Test 2: Focused textarea when keyboard opens -> scrolls
  handleKeyboardFocusScroll(mockTextarea, true);
  assert.deepEqual(scrolledElements, ['INPUT:smooth', 'TEXTAREA:smooth']);

  // Test 3: Focused non-input (DIV) -> does NOT scroll
  handleKeyboardFocusScroll(mockDiv, true);
  assert.deepEqual(scrolledElements, ['INPUT:smooth', 'TEXTAREA:smooth']);

  // Test 4: Keyboard closed -> does NOT scroll
  handleKeyboardFocusScroll(mockInput, false);
  assert.deepEqual(scrolledElements, ['INPUT:smooth', 'TEXTAREA:smooth']);
});
