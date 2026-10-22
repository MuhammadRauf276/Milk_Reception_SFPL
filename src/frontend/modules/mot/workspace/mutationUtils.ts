import { fetchJson } from '@/lib/query/fetchJson';

/** JSON request for useMutation; keeps the original per-action fallback text when the server sends no message. */
export async function sendJson<T = any>(
  url: string,
  method: 'POST' | 'PATCH',
  body: unknown,
  fallbackMessage: string
): Promise<T> {
  try {
    return await fetchJson<T>(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    if (err instanceof Error && /^Request failed \(\d+\)$/.test(err.message)) throw new Error(fallbackMessage);
    throw err;
  }
}
