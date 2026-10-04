const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function csrfHeaders(): Record<string, string> {
  const token = document.cookie.split('; ').find((entry) => entry.startsWith('project_tracker_csrf='))?.split('=')[1];
  return token ? { 'x-csrf-token': decodeURIComponent(token) } : {};
}

export function uploadAttachment<T>(itemId: string, file: File, onProgress: (percent: number) => void, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ApiError('Upload cancelled', 0));
      return;
    }
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const cleanup = () => signal?.removeEventListener('abort', abort);
    xhr.open('POST', `${API_URL}/items/${encodeURIComponent(itemId)}/attachments`);
    xhr.withCredentials = true;
    for (const [name, value] of Object.entries(csrfHeaders())) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100));
    };
    xhr.onload = () => {
      cleanup();
      let data: { error?: { message?: string; details?: unknown } } = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* The server may return a non-JSON error. */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as T);
      else reject(new ApiError(data?.error?.message ?? 'Upload failed', xhr.status, data?.error?.details));
    };
    xhr.onerror = () => { cleanup(); reject(new ApiError('Upload failed. Check your connection and retry.', 0)); };
    xhr.onabort = () => { cleanup(); reject(new ApiError('Upload cancelled', 0)); };
    const body = new FormData();
    body.append('file', file);
    signal?.addEventListener('abort', abort, { once: true });
    xhr.send(body);
  });
}

export async function attachmentBlob(id: string): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}/attachments/${encodeURIComponent(id)}`, {
      credentials: 'include',
      headers: csrfHeaders(),
      redirect: 'error',
    });
  } catch {
    throw new ApiError('Could not download through the attachment API proxy. Direct storage redirects are not allowed; check the server proxy configuration or your connection.', 0);
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new ApiError(data?.error?.message ?? 'Download failed', response.status);
  }
  return response.blob();
}

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
