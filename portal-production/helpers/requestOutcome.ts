// What a request() reply means for the screen (round 16, guru 2026-11-19).
//
// request() (helpers/request.ts) never throws: a failed call RESOLVES { success: false, message }. A screen must
// check that before it says "saved", closes a dialog, clears a form or reloads as if the change went through, and a
// list screen must not treat the failure object as its rows.
//
// Pure: no React or request imports, so `npm test` (node --test) runs it directly.

import { apiMessageText, TIMED_OUT_TEXT } from "./apiErrorToast";

export interface RequestFailure {
  success: false;
  message?: unknown;
  timedOut?: boolean;
  code?: unknown;
  details?: unknown;
}

/** The call failed (request() resolved its failure shape). A 204 / empty reply is not a failure. */
export const requestFailed = (res: unknown): res is RequestFailure =>
  !!res && typeof res === "object" && (res as { success?: unknown }).success === false;

/** The failure's message as one plain line (no em-dashes, never cut), else the fallback. */
export function failureText(res: unknown, fallback: string): string {
  if (requestFailed(res)) {
    if (res.timedOut) return TIMED_OUT_TEXT;
    return apiMessageText(res.message) ?? fallback;
  }
  return fallback;
}

/** "<what failed>. <the API's reason>" for a screen's own error line; just `what` when there is no reason. */
export function failureLine(res: unknown, what: string): string {
  const reason = failureText(res, "");
  return reason ? `${what}. ${reason}` : what;
}

/** The reply's body: the API wraps it as { success, data, message }; older routes answer bare. */
export const replyBody = (res: unknown): unknown =>
  res && typeof res === "object" && !Array.isArray(res) && (res as { data?: unknown }).data !== undefined ? (res as { data: unknown }).data : res;

/**
 * Rows for a list from a request() reply. Never throws and never hands back the failure object: a failure gives
 * no rows and an error ("<what failed>. <the API's reason>"); an odd shape gives no rows. `pick` reads the array
 * out of the body (default: the body).
 */
export function listFrom<T = unknown>(res: unknown, what: string, pick: (body: any) => unknown = (b) => b): { rows: T[]; error: string | null } { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (requestFailed(res)) return { rows: [], error: failureLine(res, what) };
  let picked: unknown;
  try {
    picked = pick(replyBody(res));
  } catch {
    picked = undefined;
  }
  return { rows: Array.isArray(picked) ? (picked as T[]) : [], error: null };
}
