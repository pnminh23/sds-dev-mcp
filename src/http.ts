export class HttpError extends Error {
  constructor(
    public status: number,
    public body: string,
    url: string,
  ) {
    super(`HTTP ${status} khi gọi ${url}: ${body.slice(0, 800)}`);
  }
}

export interface HttpOptions {
  method?: string;
  token?: string;
  body?: unknown;
  timeoutMs?: number;
}

export async function http<T = unknown>(url: string, opts: HttpOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
  });
  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status, text, url);
  return (text ? JSON.parse(text) : undefined) as T;
}
