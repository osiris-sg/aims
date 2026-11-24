// Stored files (security, 2026-11-24): every <img src> / download of an
// uploaded file goes through fileSrc(). Signed-in pages get /api/f/<key>,
// which checks the session and the org server-side and redirects to a
// short-lived signed URL. Values that already are URLs (signed links handed out
// by a public token page's backend, data: / blob: previews) pass through; a
// stored public URL of our bucket is turned back into its key first.

const BUCKET_URL_RE =
  /^https?:\/\/(?:aims-osiris\.s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com\/|s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com\/aims-osiris\/)/i;

/** Pages without a Clerk session (token links): they must get signed URLs from their own backend. */
const PUBLIC_PATH_RE = /^\/(guest|pay|sign|schedule|book|signature|preview)(\/|$)/;

// Signed links a token page's backend handed out ({ stored value → URL }), see registerSignedUrls.
const signedUrls = new Map<string, string>();

/** Remember the `fileUrls` map a public token endpoint returned (no session on those pages). */
export function registerSignedUrls(map: unknown): void {
  if (!map || typeof map !== "object") return;
  for (const [k, v] of Object.entries(map as Record<string, unknown>)) if (typeof v === "string") signedUrls.set(k, v);
}

function onPublicPage(): boolean {
  return typeof window !== "undefined" && PUBLIC_PATH_RE.test(window.location.pathname);
}

/** A stored value → our bucket key, or null when it is not one of our files (data:, blob:, other hosts). */
export function storedKeyOf(v: string | null | undefined): string | null {
  if (!v || typeof v !== "string") return null;
  let s = v.trim();
  if (!s || /^(data|blob):/i.test(s)) return null;
  if (/^https?:\/\//i.test(s)) {
    if (!BUCKET_URL_RE.test(s)) return null;
    // A presigned link is already good to use as is.
    if (/[?&]X-Amz-Signature=/i.test(s)) return null;
    s = s.replace(BUCKET_URL_RE, "").split(/[?#]/)[0];
    try {
      s = decodeURIComponent(s);
    } catch {
      /* keep */
    }
  }
  if (s.startsWith("/api/f/")) return null;
  s = s.replace(/^\/+/, "");
  return s || null;
}

/** The URL to show / open a stored file. `download` saves it under that name. */
export function fileSrc(v: string | null | undefined, opts: { download?: string } = {}): string {
  if (!v) return "";
  const signed = signedUrls.get(v) ?? signedUrls.get(v.trim());
  if (signed && !opts.download) return signed;
  const key = storedKeyOf(v);
  if (!key) return v; // data:, blob:, signed links, /api/f/..., other hosts
  if (onPublicPage()) {
    const signedKey = signedUrls.get(key);
    if (signedKey) return signedKey;
    // A file the token page's backend did not sign: the public base while the bucket is still public.
    const base = process.env.NEXT_PUBLIC_RESOURCE_URL || "";
    return base ? `${base.replace(/\/$/, "")}/${key}` : v;
  }
  const path = `/api/f/${key.split("/").map(encodeURIComponent).join("/")}`;
  const q = new URLSearchParams();
  if (opts.download) q.set("download", opts.download);
  // Admin "viewing as org": the active org travels with the link (sessionStorage is client-only).
  try {
    const active = typeof window !== "undefined" ? window.sessionStorage.getItem("aims-admin-active-org") : null;
    if (active) q.set("org", active);
  } catch {
    /* storage blocked */
  }
  const qs = q.toString();
  return qs ? `${path}?${qs}` : path;
}
