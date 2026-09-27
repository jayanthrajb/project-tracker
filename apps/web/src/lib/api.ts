const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export class ApiError extends Error {
  details?: unknown;
  status: number;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method?.toUpperCase() ?? 'GET';
  const csrfToken = typeof document !== 'undefined'
    ? document.cookie
        .split('; ')
        .find((entry) => entry.startsWith('project_tracker_csrf='))
        ?.split('=')[1]
    : undefined;

  const response = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    headers: {
      ...(csrfToken && !SAFE_METHODS.has(method) ? { 'x-csrf-token': decodeURIComponent(csrfToken) } : {}),
      ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...init?.headers,
    },
    ...init,
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(data?.error?.message ?? 'Request failed', response.status, data?.error?.details);
  }
  return data as T;
}
