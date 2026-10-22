/** fetch + JSON for TanStack Query. Passes the abort signal; throws Error(message) on non-2xx. */
export async function fetchJson<T>(url: string, init?: RequestInit & { signal?: AbortSignal }): Promise<T> {
  const res = await fetch(url, { credentials: 'same-origin', ...init });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (body && (body.error || body.message)) || `Request failed (${res.status})`;
    throw new Error(typeof msg === 'string' ? msg : `Request failed (${res.status})`);
  }
  return body as T;
}
