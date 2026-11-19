// Environment-agnostic structural transport types shared by the whole package.
//
// No DOM lib, no @types/node: consumers inject their own WebSocket/fetch (or
// the services read them off `globalThis` at call time), so the package never
// names the concrete `WebSocket`/`Response` types from either environment.

/** The fields of a WebSocket `close` event this package reads. */
export interface WebSocketCloseEventLike {
  /** Close code (e.g. 1000 normal, 1006 abnormal, 1008 policy violation). */
  code?: number;
  /** Close reason sent by the peer (browsers hide it for rejected handshakes). */
  reason?: string;
}

export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  /**
   * Real sockets pass a `CloseEvent` (which carries `code`/`reason`); test
   * doubles may call it with no argument.
   */
  onclose: ((ev?: WebSocketCloseEventLike) => void) | null;
  onerror: (() => void) | null;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

/**
 * `FormData` when the consumer's type universe declares one (the DOM lib, or
 * `@types/node`), `never` otherwise. Resolved in the consumer's program, so a
 * DOM app sees `body?: string | FormData` while this package itself (which
 * compiles without either lib) sees `body?: string`.
 */
export type HostFormData = typeof globalThis extends {
  FormData: abstract new (...args: never) => infer F;
}
  ? F
  : never;

/**
 * `Blob` (a `File` included) when the consumer's type universe declares one,
 * `never` otherwise; resolved in the consumer's program like
 * {@link HostFormData}.
 */
export type HostBlob = typeof globalThis extends {
  Blob: abstract new (...args: never) => infer B;
}
  ? B
  : never;

/**
 * Minimal `fetch` shape used by every REST call. The global `fetch` (browser
 * or Node) satisfies it, as do simple test fakes.
 *
 * `body` is the JSON-serialized request body, or the caller's `FormData`
 * passed through untouched for multipart requests; it is absent for requests
 * without a body. At runtime `canopyFetch` also passes `signal` when the
 * caller provided one (not declared here so the global `fetch` stays
 * assignable).
 *
 * `redirect` and `type` are optional so a minimal fetch stays assignable;
 * `HarePVService.submit` sends `redirect: 'manual'` and reads `type` to see an
 * unfollowed redirect (`'opaqueredirect'`).
 */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string | HostFormData;
    redirect?: 'follow' | 'manual' | 'error';
  }
) => Promise<{ ok: boolean; status: number; type?: string; text(): Promise<string> }>;
