'use client';

import { useEffect, useRef } from 'react';

const DEFAULT_MS = 5000;

/** Hides a success or info message after a few seconds, so it cannot stay on the page after the moment has passed. */
export function useAutoClearMessage<T>(message: T | null, clear: (value: null) => void, ms: number = DEFAULT_MS): void {
  const clearRef = useRef(clear);
  useEffect(() => {
    clearRef.current = clear;
  });
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => clearRef.current(null), ms);
    return () => clearTimeout(timer);
  }, [message, ms]);
}
