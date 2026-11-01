'use client';

export class ApiError extends Error {
  public status: number;
  public code?: string;
  public isNetworkError: boolean;
  public isTimeout: boolean;
  public isAuthExpired: boolean;
  public data?: unknown;

  constructor(
    message: string,
    status = 500,
    code?: string,
    options?: {
      isNetworkError?: boolean;
      isTimeout?: boolean;
      isAuthExpired?: boolean;
      data?: unknown;
    }
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.isNetworkError = options?.isNetworkError ?? false;
    this.isTimeout = options?.isTimeout ?? false;
    this.isAuthExpired = options?.isAuthExpired ?? false;
    this.data = options?.data;
  }
}

export interface ApiRequestOptions extends RequestInit {
  timeoutMs?: number;
  dedupKey?: string;
  idempotencyKey?: string;
  retries?: number;
}

// Global registry of in-flight mutations to prevent accidental double-submits
const activeMutationKeys = new Set<string>();

export const AUTH_EXPIRED_EVENT = 'milk-auth-expired';

function dispatchAuthExpired() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
  }
}

/**
 * Robust fetch wrapper with timeout, standardized error typing, and session expiry detection.
 */
export async function apiRequest<T = unknown>(
  url: string,
  options: ApiRequestOptions = {}
): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();
  const isMutation = method !== 'GET' && method !== 'HEAD';
  const timeoutMs = options.timeoutMs ?? (isMutation ? 15_000 : 10_000);

  // In-flight deduplication for mutations
  let mutationKey: string | null = null;
  if (isMutation) {
    mutationKey = `${method}:${url}:${options.dedupKey || ''}`;
    if (activeMutationKeys.has(mutationKey)) {
      throw new ApiError(
        'An identical transaction is already in progress. Please wait for it to complete.',
        429,
        'DUPLICATE_IN_FLIGHT'
      );
    }
    activeMutationKeys.add(mutationKey);
  }

  try {
    return await executeWithTimeout<T>(url, options, method, timeoutMs);
  } finally {
    if (mutationKey) {
      activeMutationKeys.delete(mutationKey);
    }
  }
}

async function executeWithTimeout<T>(
  url: string,
  options: ApiRequestOptions,
  method: string,
  timeoutMs: number
): Promise<T> {
  const controller = new AbortController();
  const timeoutTimer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  // If caller supplied their own signal, listen to it
  if (options.signal) {
    options.signal.addEventListener('abort', () => controller.abort());
  }

  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }
  if (options.idempotencyKey) {
    headers.set('Idempotency-Key', options.idempotencyKey);
  } else if (method === 'POST' || method === 'PUT') {
    const autoKey =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
    headers.set('Idempotency-Key', autoKey);
  }

  const maxRetries = method === 'GET' ? (options.retries ?? 1) : 0;
  let attempt = 0;

  while (attempt <= maxRetries) {
    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutTimer);

      if (response.status === 401) {
        dispatchAuthExpired();
        const errJson = await response.json().catch(() => ({}));
        throw new ApiError(
          errJson.error || 'Your session has expired. Please sign in again.',
          401,
          'SESSION_EXPIRED',
          { isAuthExpired: true }
        );
      }

      const contentType = response.headers.get('content-type') || '';
      const isJson = contentType.includes('application/json');
      const data = isJson ? await response.json().catch(() => ({})) : await response.text();

      if (!response.ok) {
        const errorMsg =
          typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string'
            ? data.error
            : `Request failed with status ${response.status}`;
        const errorCode =
          typeof data === 'object' && data !== null && 'code' in data && typeof data.code === 'string'
            ? data.code
            : undefined;

        throw new ApiError(errorMsg, response.status, errorCode, { data });
      }

      return data as T;
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        throw err;
      }

      const isAbort = err instanceof Error && err.name === 'AbortError';
      const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;

      if (isAbort) {
        throw new ApiError(
          `Request timed out after ${Math.round(timeoutMs / 1000)} seconds. Please check connection and try again.`,
          408,
          'REQUEST_TIMEOUT',
          { isTimeout: true }
        );
      }

      // If GET request failed on network and has retries remaining, wait with backoff
      if (method === 'GET' && attempt < maxRetries) {
        attempt++;
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
        continue;
      }

      clearTimeout(timeoutTimer);
      throw new ApiError(
        isOffline
          ? 'Network connection unavailable. Please check your internet connection.'
          : 'Unable to reach the server. Please verify your connection and try again.',
        0,
        'NETWORK_FAILURE',
        { isNetworkError: true }
      );
    }
  }

  clearTimeout(timeoutTimer);
  throw new ApiError('Request failed after retries.', 0, 'MAX_RETRIES_EXCEEDED');
}

/**
 * Specialized helpers for clean, ergonomic usage across components
 */
export const apiClient = {
  get: <T = unknown>(url: string, options?: Omit<ApiRequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(url, { ...options, method: 'GET' }),

  post: <T = unknown>(url: string, body?: unknown, options?: Omit<ApiRequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(url, {
      ...options,
      method: 'POST',
      body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
    }),

  put: <T = unknown>(url: string, body?: unknown, options?: Omit<ApiRequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(url, {
      ...options,
      method: 'PUT',
      body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
    }),

  delete: <T = unknown>(url: string, options?: Omit<ApiRequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(url, { ...options, method: 'DELETE' }),
};
