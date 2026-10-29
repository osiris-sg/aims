// Admin → organisation → SiteClock tab helpers (2026-10-30). Pure: tested by
// helpers/siteclockConnection.test.mjs.
//
// request() never throws: on an HTTP error it RETURNS { success: false, message }.
// The tab used to read `res?.data ?? res`, so a rejected save handed that error
// object to the form as if it were the connection: "saved" toast, every field
// cleared, and the "AIMS_SECRETS_KEY is not set" warning (secretsReady missing).

export interface Conn {
  connected: boolean;
  secretsReady: boolean;
  baseUrl?: string;
  siteclockCompanyId?: string;
  apiKeyLast4?: string;
  enabled?: boolean;
  defaultDurationMin?: number;
  lastOkAt?: string | null;
  lastError?: string | null;
}

/** The payload of a { success, data } response; throws the server's message when the call failed. */
export function unwrap<T>(res: any, fallback = "Request failed"): T {
  if (res == null) throw new Error(fallback);
  if (res.success === false) {
    const m = res.details?.message ?? res.message;
    throw new Error((Array.isArray(m) ? m.join(". ") : m) || fallback);
  }
  return (res.success === true && "data" in res ? res.data : res) as T;
}

/** A real connection payload (guards against ever filling the form with something else). */
export const isConn = (v: any): v is Conn => !!v && typeof v === "object" && typeof v.connected === "boolean" && typeof v.secretsReady === "boolean";

/** "Key stored (…u0XK)" once a key is saved, else null. */
export const keyStoredLabel = (c: Conn | null | undefined) => (c?.connected && c.apiKeyLast4 ? `Key stored (…${c.apiKeyLast4})` : null);

/** Show the missing-secrets warning only when the server actually said so. */
export const secretsMissing = (c: Conn | null | undefined) => !!c && c.secretsReady === false;

/** The Test connection result line. */
export function testResultText(r: { ok?: boolean; teams?: number; error?: string } | null | undefined): { ok: boolean; text: string } {
  if (r?.ok) return { ok: true, text: `Connected: ${r.teams ?? 0} team${r.teams === 1 ? "" : "s"} in SiteClock` };
  return { ok: false, text: `SiteClock said: ${r?.error || "unknown error"}` };
}
