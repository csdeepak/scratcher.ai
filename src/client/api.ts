// Thin HTTP client for the local Waymark server, plus the live event stream.

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { ...(init?.json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
      body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
    });
  } catch {
    throw new ApiError(0, 'The Waymark server is not reachable. Is it still running?');
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg = (data && typeof data === 'object' && 'error' in data ? String((data as { error: unknown }).error) : null) ?? `Request failed (${res.status}).`;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

export const http = {
  get: <T>(p: string) => api<T>(p),
  post: <T>(p: string, json?: unknown) => api<T>(p, { method: 'POST', json: json ?? {} }),
  patch: <T>(p: string, json: unknown) => api<T>(p, { method: 'PATCH', json }),
  put: <T>(p: string, json: unknown) => api<T>(p, { method: 'PUT', json }),
  del: <T>(p: string) => api<T>(p, { method: 'DELETE' }),
};

export type ServerEvent =
  | { type: 'roadmap'; roadmapId: string; ids: string[]; source: string }
  | { type: 'roadmaps' }
  | { type: 'review' };

export function subscribe(onEvent: (e: ServerEvent) => void, onStatus: (connected: boolean) => void): () => void {
  let es: EventSource | null = null;
  let closed = false;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let delay = 2000; // grows to 30 s while the server is down, so a stopped server isn't hammered
  const open = () => {
    es = new EventSource('/api/events');
    es.addEventListener('hello', () => {
      delay = 2000;
      onStatus(true);
    });
    for (const type of ['roadmap', 'roadmaps', 'review'] as const) {
      es.addEventListener(type, (ev) => {
        try {
          onEvent(JSON.parse((ev as MessageEvent).data) as ServerEvent);
        } catch {
          /* ignore malformed */
        }
      });
    }
    es.onerror = () => {
      onStatus(false);
      // Take over reconnecting from the browser so the delay can back off.
      if (!closed) {
        es?.close();
        if (retry) clearTimeout(retry);
        retry = setTimeout(open, delay);
        delay = Math.min(delay * 2, 30_000);
      }
    };
  };
  open();
  return () => {
    closed = true;
    if (retry) clearTimeout(retry);
    es?.close();
  };
}

export async function downloadJson(path: string, fallbackName: string) {
  const res = await fetch(path);
  if (!res.ok) throw new ApiError(res.status, 'Export failed.');
  const disposition = res.headers.get('content-disposition') ?? '';
  const name = disposition.match(/filename="([^"]+)"/)?.[1] ?? fallbackName;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
