// /preview/wct-jobs?page=orders|jobs&status=to_verify&mode=light|dark&many=1 (many: 64 orders, for the Showing page size) — WCT's Orders and Jobs pages
// rendered from fixtures (no sign-in, no API) for layout checks and screenshots.
// Only with PREVIEW_FIXTURES=1 in the server's environment; 404 otherwise.
import { notFound } from "next/navigation";
import { Suspense } from "react";
import PreviewClient from "./PreviewClient";

export const dynamic = "force-dynamic";

export default function PreviewWctJobsPage({ searchParams }: { searchParams?: Record<string, string | undefined> }) {
  if (process.env.PREVIEW_FIXTURES !== "1") notFound();
  return (
    <Suspense fallback={null}>
      <PreviewClient mode={searchParams?.mode === "dark" ? "dark" : "light"} page={searchParams?.page === "orders" ? "orders" : "jobs"} many={searchParams?.many === "1"} />
    </Suspense>
  );
}
