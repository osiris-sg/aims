import { auth } from "@clerk/nextjs/server";

// Org-checked file links (security, 2026-11-24): /api/f/<key> checks the Clerk
// session, asks the backend (POST /files/sign: membership check) for a ~10 min
// presigned URL and 302-redirects to it, so <img src> and window.open keep
// working with a plain path. No session → 401; a file of an org the user has no
// access to → 403; backend unreachable → 404. `?download=<name>` saves the file
// under that name.
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { key: string[] } }) {
  const { userId, getToken } = auth();
  if (!userId) return new Response("Sign in to open this file", { status: 401, headers: { "Cache-Control": "no-store" } });
  const key = (params.key || []).map((p) => decodeURIComponent(p)).join("/");
  if (!key || key.includes("..")) return new Response("Not found", { status: 404 });
  const token = await getToken();
  const url = new URL(req.url);
  const downloadAs = url.searchParams.get("download") || undefined;
  const headers: Record<string, string> = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  // Admin "viewing as org": the active org travels as a query param from the page (sessionStorage is client-only).
  const activeOrg = url.searchParams.get("org");
  if (activeOrg) headers["X-Active-Org-Id"] = activeOrg;
  let signed: string | null = null;
  let refused = false;
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}/files/sign`, {
      method: "POST",
      headers,
      body: JSON.stringify({ keys: [key], ...(downloadAs ? { downloadAs } : {}) }),
      cache: "no-store",
    });
    if (res.ok) {
      const body = await res.json();
      signed = (body?.data?.urls ?? body?.urls)?.[key] ?? null;
      refused = !signed;
    } else refused = res.status === 403;
  } catch {
    signed = null;
  }
  if (refused) return new Response("You do not have access to this file", { status: 403, headers: { "Cache-Control": "no-store" } });
  if (!signed) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  // The browser may reuse the redirect for a few minutes (the signed URL lives ~10).
  return new Response(null, { status: 302, headers: { Location: signed, "Cache-Control": "private, max-age=300" } });
}
