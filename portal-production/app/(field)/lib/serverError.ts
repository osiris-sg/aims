/**
 * The server's own sentence for a failed request(). request() resolves (never
 * throws) with { success: false, message } on an error, and a validation 400
 * carries message as an array. Without this the field screens said only
 * "No report id returned" (Biofuel return #101, 2026-11-10).
 */
export function serverError(res: any, fallback: string): string {
  if (res?.success !== false) return fallback;
  const msg = [res.message].flat().filter(Boolean).join("; ");
  return msg || fallback;
}
