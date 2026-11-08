/**
 * Runs at most once per `waitMs`, always including the last call.
 * For events that fire very fast, like scroll and resize. Use debounce for search boxes.
 */
export function throttle<A extends unknown[]>(fn: (...args: A) => void, waitMs: number) {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: A | null = null;

  const throttled = (...args: A) => {
    const now = Date.now();
    const remaining = waitMs - (now - last);
    if (remaining <= 0) {
      last = now;
      fn(...args);
      return;
    }
    pending = args;
    if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        last = Date.now();
        if (pending) fn(...pending);
        pending = null;
      }, remaining);
    }
  };

  throttled.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    pending = null;
  };

  return throttled;
}
