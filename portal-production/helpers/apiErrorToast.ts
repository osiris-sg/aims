// Portal-wide error toast for the shared request() helper (helpers/request.ts), guru 2026-11-19.
//
// request() used to post a failed call's message to a Redux notice that no screen mounts, so a failure was
// silent unless the screen showed its own error. Now a failed call on a /portal page shows ONE short toast,
// unless:
//   - the call says its screen shows its own error:           request({ path, method, ownError: true }, ...)
//   - the call is background work (poll, heartbeat, bootstrap,
//     best-effort or an expected "not found"):                request({ path, method, quiet: true }, ...)
//   - it was cancelled (the caller's AbortSignal, or the page unloading), not timed out;
//   - the user has left the screen that made it (pathname changed), so the screen is gone;
//   - it is a 401 (the sign-in redirect owns that), or a 403 on a read (a GET, or a POST that lists: the house
//     convention "POST / = list"): a role that may not see some data (a category filter, a supplier picker) is not
//     an error the user can act on. A refused write shows;
//   - the page is not a /portal page (field app, guest and public pages keep their own UI).
// The same text within DEDUPE_MS shows once (React Query retries, parallel calls failing alike).
//
// Pure: no React, axios or toast imports, so `npm test` (node --test) runs it directly.

export interface ApiErrorFlags {
  /** The screen shows its own error for a failed call (its own toast, Alert or inline text). */
  ownError?: boolean;
  /** Background work whose failure is not a user-facing error (poll, heartbeat, bootstrap, best-effort). */
  quiet?: boolean;
}

export interface ApiFailure {
  flags?: ApiErrorFlags | null;
  /** HTTP status when the server answered; undefined when it never did (network down, timeout, abort). */
  status?: number;
  /** The call's HTTP method ("GET", "POST", ...) and API path. */
  method?: string | null;
  path?: string | null;
  /** The API's message (error.response.data.message): a string, or class-validator's string[]. */
  apiMessage?: unknown;
  /** request()'s own timer fired. */
  timedOut?: boolean;
  /** The request never reached the server (axios "Network Error"). */
  offline?: boolean;
  /** Aborted by the caller's signal or the page unloading, not by request()'s timer. */
  cancelled?: boolean;
  /** window.location.pathname when the call started and when it failed. */
  startPath?: string | null;
  currentPath?: string | null;
}

type AxiosLikeError = { code?: string; name?: string; message?: string; response?: { status?: unknown; data?: { message?: unknown } | null } };

/**
 * The ApiFailure for an axios error caught in request(). `timerFired` = request()'s own timeout fired;
 * any other abort (the caller's signal, the page unloading) is a cancel.
 */
export function failureFromAxiosError(
  error: unknown,
  ctx: { meta?: (ApiErrorFlags & { method?: string; path?: string }) | null; timerFired?: boolean; startPath?: string | null; currentPath?: string | null }
): ApiFailure {
  const e = (error ?? {}) as AxiosLikeError;
  const status = typeof e.response?.status === "number" ? e.response.status : undefined;
  const text = String(e.message || "");
  const ranOutOfTime = !!ctx.timerFired || e.code === "ETIMEDOUT" || /timeout/i.test(text);
  const aborted = e.code === "ECONNABORTED" || e.code === "ERR_CANCELED" || e.name === "CanceledError" || /aborted|canceled/i.test(text);
  return {
    flags: { ownError: !!ctx.meta?.ownError, quiet: !!ctx.meta?.quiet },
    status,
    method: ctx.meta?.method ?? null,
    path: typeof ctx.meta?.path === "string" ? ctx.meta.path : null,
    apiMessage: e.response?.data?.message,
    timedOut: status === undefined && ranOutOfTime,
    offline: status === undefined && !ranOutOfTime && (e.code === "ERR_NETWORK" || /network error/i.test(text)),
    cancelled: status === undefined && !ranOutOfTime && aborted,
    startPath: ctx.startPath ?? null,
    currentPath: ctx.currentPath ?? null,
  };
}

export type ApiToastSkip = "own-error" | "quiet" | "cancelled" | "left-screen" | "signed-out" | "no-read-permission" | "outside-portal";

export type ApiToastDecision = { show: true; message: string } | { show: false; reason: ApiToastSkip };

export const TIMED_OUT_TEXT = "Request timed out. Please try again.";
export const OFFLINE_TEXT = "Could not reach the server. Please try again.";
export const FALLBACK_TEXT = "Something went wrong. Please try again.";
/** Longer API messages are not "short text"; the plain fallback shows instead (never cut with "…"). */
export const MAX_MESSAGE_CHARS = 200;
export const DEDUPE_MS = 8000;

/**
 * POSTs that only read (list / search / preview), so a 403 on them is a read the role may not do. Mirrors the API's
 * VIEW_POST_RE (api-server-production/src/action-log/action-log.interceptor.ts); keep the two in step.
 */
export const READ_POST_RE =
  /^\/(documents(\/paginated|\/stats|\/wct-delete\/check)?|assets|inventories(\/by-status|\/by-ids)?|customers(\/lookup)?|suppliers|projects|documentTemplates|users\/list|payments\/summary|statements\/(soa|supplier-soa)|posting-preview|documentTemplates\/variants\/[^/]+\/design-preview|trade-generated\/preview|trade-clients\/customers\/[0-9a-f-]{36}\/formats\/[A-Z_]+\/(preview|layout-preview)|trade-clients\/customers\/[0-9a-f-]{36}\/(process|due-rules)\/preview|email-inbox\/[0-9a-f-]{36}\/preview|email-inbox\/placements|email-inbox\/shipment-facts|payables\/match-payment|field\/jobs\/import\/preview)$/;

/** A call that only reads: a GET (or no method), or a listing POST. */
export const isReadCall = (method?: string | null, path?: string | null): boolean => {
  const m = String(method || "GET").toUpperCase();
  if (m === "GET") return true;
  return m === "POST" && !!path && READ_POST_RE.test(path.split("?")[0]);
};

export const isPortalPath = (path?: string | null): boolean => !!path && (path === "/portal" || path.startsWith("/portal/"));

/** UI copy rule: no em-dashes. "Cannot void — posted" reads "Cannot void - posted". */
const plain = (s: string): string => s.replace(/\s*[—–]\s*/g, " - ").replace(/\s+/g, " ").trim();

/** The API's message as one plain line, or null when it has none worth showing. */
export function apiMessageText(apiMessage: unknown): string | null {
  const parts = Array.isArray(apiMessage) ? apiMessage : [apiMessage];
  const text = plain(
    parts
      .filter((p): p is string => typeof p === "string" && p.trim() !== "")
      .map((p) => p.trim())
      .join("; ")
  );
  if (!text || text.length > MAX_MESSAGE_CHARS) return null;
  return text;
}

/** The toast text: timed out, else the API's message, else a plain fallback. */
export function apiErrorToastText(f: Pick<ApiFailure, "timedOut" | "offline" | "apiMessage" | "status">): string {
  if (f.timedOut) return TIMED_OUT_TEXT;
  const api = apiMessageText(f.apiMessage);
  if (api) return api;
  return f.offline ? OFFLINE_TEXT : FALLBACK_TEXT;
}

export function apiErrorToastDecision(f: ApiFailure): ApiToastDecision {
  if (f.flags?.ownError) return { show: false, reason: "own-error" };
  if (f.flags?.quiet) return { show: false, reason: "quiet" };
  if (f.cancelled && !f.timedOut) return { show: false, reason: "cancelled" };
  if (f.status === 401) return { show: false, reason: "signed-out" };
  if (f.status === 403 && isReadCall(f.method, f.path)) return { show: false, reason: "no-read-permission" };
  if (!isPortalPath(f.currentPath)) return { show: false, reason: "outside-portal" };
  if (f.startPath && f.currentPath !== f.startPath) return { show: false, reason: "left-screen" };
  return { show: true, message: apiErrorToastText(f) };
}

/**
 * The toaster request() calls on every failure: decides, de-duplicates the same text within DEDUPE_MS, then
 * hands the text to `show` (react-toastify in the app, a spy in tests). Returns what it decided.
 */
export function createApiErrorToaster(opts: { show: (message: string) => void; now?: () => number; dedupeMs?: number }) {
  const now = opts.now ?? (() => Date.now());
  const dedupeMs = opts.dedupeMs ?? DEDUPE_MS;
  const lastShown = new Map<string, number>();
  return (f: ApiFailure): ApiToastDecision | { show: false; reason: "duplicate" } => {
    const d = apiErrorToastDecision(f);
    if (!d.show) return d;
    const t = now();
    const prev = lastShown.get(d.message);
    if (prev !== undefined && t - prev < dedupeMs) return { show: false, reason: "duplicate" };
    lastShown.set(d.message, t);
    if (lastShown.size > 50) {
      for (const [k, v] of lastShown) if (t - v >= dedupeMs) lastShown.delete(k);
    }
    opts.show(d.message);
    return d;
  };
}
