'use client';

import { useState, useEffect } from 'react';

export interface VisualViewportState {
  height: number | null;
  width: number | null;
  isKeyboardOpen: boolean;
  keyboardHeight: number;
}

const DEFAULT_STATE: VisualViewportState = {
  height: null,
  width: null,
  isKeyboardOpen: false,
  keyboardHeight: 0,
};

/**
 * Universal hook for tracking Android Chrome / mobile visual viewport changes,
 * particularly for on-screen virtual keyboard detection and drawer/modal sizing.
 */
export function useVisualViewport(): VisualViewportState {
  const [state, setState] = useState<VisualViewportState>(DEFAULT_STATE);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const vv = window.visualViewport;
    if (!vv) {
      // Fallback for browsers without visualViewport support
      const onResize = () => {
        setState({
          height: window.innerHeight,
          width: window.innerWidth,
          isKeyboardOpen: false,
          keyboardHeight: 0,
        });
      };
      onResize();
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    }

    const update = () => {
      const vvh = vv.height;
      const vvw = vv.width;
      const windowHeight = window.innerHeight;
      const heightDiff = windowHeight - vvh;
      // Android software keyboard typically occupies > 150px
      const isKeyboardOpen = heightDiff > 150;
      const keyboardHeight = isKeyboardOpen ? Math.max(0, heightDiff) : 0;

      setState({
        height: vvh,
        width: vvw,
        isKeyboardOpen,
        keyboardHeight,
      });

      // Keep focused input visible inside viewport when keyboard opens
      if (isKeyboardOpen && typeof document !== 'undefined') {
        const active = document.activeElement as HTMLElement | null;
        if (
          active &&
          (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')
        ) {
          setTimeout(() => {
            active.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }, 100);
        }
      }
    };

    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);

    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  return state;
}

/**
 * Convenience hook returning just the visual viewport height in pixels,
 * or null before hydration/on desktop.
 */
export function useVisualViewportHeight(): number | null {
  const { height } = useVisualViewport();
  return height;
}
