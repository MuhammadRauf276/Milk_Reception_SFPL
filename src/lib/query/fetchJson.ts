/** fetch + JSON for TanStack Query. Applies a 20s timeout unless an earlier caller abort triggers, and throws Error(message) on non-2xx. */
const FETCH_TIMEOUT_MS = 20_000;

export async function fetchJson<T>(url: string, init?: RequestInit & { signal?: AbortSignal; timeoutMs?: number }): Promise<T> {
  const { signal: callerSignal, timeoutMs = FETCH_TIMEOUT_MS, ...rest } = init ?? {};
  const controller = new AbortController();
  let timedOut = false;

  const onCallerAbort = () => controller.abort(callerSignal?.reason);
  if (callerSignal) {
    if (callerSignal.aborted) {
      controller.abort(callerSignal.reason);
    } else {
      callerSignal.addEventListener('abort', onCallerAbort, { once: true });
    }
  }

  const timer = timeoutMs > 0
    ? setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs)
    : null;

  try {
    const res = await fetch(url, {
      credentials: 'same-origin',
      ...rest,
      signal: controller.signal,
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = (body && (body.error || body.message)) || `Request failed (${res.status})`;
      throw new Error(typeof msg === 'string' ? msg : `Request failed (${res.status})`);
    }
    return body as T;
  } catch (err) {
    if (timedOut && err instanceof Error && err.name === 'AbortError') {
      throw new Error('Request timed out after 20 seconds. Please check connection and try again.');
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
    if (callerSignal) callerSignal.removeEventListener('abort', onCallerAbort);
  }
}
