// Deploy check (2026-11-03): which commit this deployment was built from, and
// whether it is the production one. Vercel sets these; nothing else is returned.
// Public in middleware.ts.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { commit: process.env.VERCEL_GIT_COMMIT_SHA || null, env: process.env.VERCEL_ENV || null },
    { headers: { "Cache-Control": "no-store" } }
  );
}
