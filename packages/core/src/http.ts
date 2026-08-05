import { log } from "./log";

/**
 * Cliente HTTP fino sobre o fetch global (Node 18+ no host; nativo na web —
 * portanto web-ready). Valor agregado: JSON automático nos dois sentidos,
 * timeout com AbortController, erros ricos (HttpError com status/corpo/url)
 * e log de cada request com duração no canal da extensão.
 */

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly statusText: string,
    readonly url: string,
    /** corpo da resposta, como texto — útil para mensagens de erro de APIs */
    readonly body: string
  ) {
    super(`HTTP ${status} ${statusText} em ${url}`);
    this.name = "HttpError";
  }
}

export interface HttpOptions {
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean>;
  /** em ms; default 30_000 */
  timeout?: number;
  signal?: AbortSignal;
}

async function request<T = unknown>(
  method: string,
  url: string,
  body?: unknown,
  opts: HttpOptions = {}
): Promise<T> {
  const target = new URL(url);
  if (opts.query) {
    for (const [key, value] of Object.entries(opts.query)) {
      target.searchParams.set(key, String(value));
    }
  }

  const timeoutMs = opts.timeout ?? 30_000;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`timeout de ${timeoutMs}ms`)),
    timeoutMs
  );
  opts.signal?.addEventListener("abort", () => controller.abort(opts.signal?.reason));

  const started = Date.now();
  try {
    const response = await http.fetchImpl(target.toString(), {
      method,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...opts.headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    log.debug(`http ${method} ${target.toString()} → ${response.status} (${Date.now() - started}ms)`);
    if (!response.ok) {
      throw new HttpError(response.status, response.statusText, target.toString(), text);
    }
    if (text.length === 0) return undefined as T;
    const contentType = response.headers.get("content-type") ?? "";
    return (contentType.includes("json") ? JSON.parse(text) : text) as T;
  } catch (err) {
    if (!(err instanceof HttpError)) {
      log.debug(`http ${method} ${target.toString()} falhou (${Date.now() - started}ms): ${String(err)}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export const http = {
  /** Trocável em testes (default: fetch global) — sem stub de globalThis. */
  fetchImpl: ((input: string | URL, init?: RequestInit) =>
    globalThis.fetch(input, init)) as typeof globalThis.fetch,
  request,
  get: <T = unknown>(url: string, opts?: HttpOptions) => request<T>("GET", url, undefined, opts),
  post: <T = unknown>(url: string, body?: unknown, opts?: HttpOptions) =>
    request<T>("POST", url, body, opts),
  put: <T = unknown>(url: string, body?: unknown, opts?: HttpOptions) =>
    request<T>("PUT", url, body, opts),
  patch: <T = unknown>(url: string, body?: unknown, opts?: HttpOptions) =>
    request<T>("PATCH", url, body, opts),
  delete: <T = unknown>(url: string, opts?: HttpOptions) =>
    request<T>("DELETE", url, undefined, opts),
};
