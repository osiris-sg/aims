// "New <type> (number on save)" (2026-11-02): Create opens the editor WITHOUT
// creating anything; the document, with its number, is created on the first
// save. Leaving without saving creates nothing. Tested by
// helpers/newDocument.test.mjs.

/** The editor route's document id for a document that does not exist yet. */
export const NEW_DOC_ID = "new";

export interface NewDocumentRequest {
  type: string; // e.g. QUOTATION, INVOICE
  templateId: string;
  numberFormatId?: string | null;
  /** Starting content (e.g. an invoice prefilled from a service report). */
  config?: Record<string, unknown>;
  projectId?: string | null;
}

const KEY_PREFIX = "aims-new-doc:";

/** Actions that need the document saved (and numbered) first; the editor runs them after the first save. */
export const THEN_ACTIONS = ["sign", "print", "email", "attachments", "share-do-view", "share-delivery", "history", "confirm"] as const;
export type ThenAction = (typeof THEN_ACTIONS)[number];
export const asThenAction = (v: unknown): ThenAction | null => (typeof v === "string" && (THEN_ACTIONS as readonly string[]).includes(v) ? (v as ThenAction) : null);

const randomKey = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

/**
 * The editor URL for a new document. The request rides in sessionStorage
 * (never in the URL: a prefill can be large and must not leak into links).
 */
export function newDocumentUrl(req: NewDocumentRequest, opts: { from?: string; query?: Record<string, string>; storage?: Pick<Storage, "setItem"> | null } = {}): string {
  const key = randomKey();
  try {
    (opts.storage ?? (typeof window !== "undefined" ? window.sessionStorage : null))?.setItem(KEY_PREFIX + key, JSON.stringify(req));
  } catch {
    // private mode: the editor falls back to the type + template in the URL
  }
  const q = new URLSearchParams({ nd: key, ...(opts.from ? { from: opts.from } : {}), ...(opts.query ?? {}) });
  return `/portal/documents/${encodeURIComponent(req.type)}/${encodeURIComponent(req.templateId)}/${NEW_DOC_ID}?${q.toString()}`;
}

/** The request stored for a new document (the URL's type + template when it is gone). */
export function readNewDocument(key: string | null, fallback: { type: string; templateId: string }, storage?: Pick<Storage, "getItem"> | null): NewDocumentRequest {
  try {
    const raw = key ? (storage ?? (typeof window !== "undefined" ? window.sessionStorage : null))?.getItem(KEY_PREFIX + key) : null;
    const v = raw ? JSON.parse(raw) : null;
    if (v && typeof v === "object" && v.templateId === fallback.templateId) return v as NewDocumentRequest;
  } catch {
    // ignore: fall back
  }
  return { ...fallback };
}

/** Header text of a new, unsaved document. */
export const numberOnSaveLabel = (title: string) => `New ${title} (number on save)`;

/** The URL a new document moves to after its first save (keeps ?from=, adds ?then= for the action that asked for the save). */
export function savedDocumentUrl(type: string, templateId: string, id: string, opts: { from?: string | null; then?: ThenAction | null; keep?: Record<string, string> } = {}): string {
  const q = new URLSearchParams({ ...(opts.keep ?? {}), ...(opts.from ? { from: opts.from } : {}), ...(opts.then ? { then: opts.then } : {}) });
  const qs = q.toString();
  return `/portal/documents/${type}/${templateId}/${id}${qs ? `?${qs}` : ""}`;
}
