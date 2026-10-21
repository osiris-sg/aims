// /preview/sales?view=dashboard|inbox — the round P pages rendered from fixtures
// (no sign-in, no API) for layout checks and the round report's screenshots.
// Only with PREVIEW_FIXTURES=1 in the server's environment; 404 otherwise.
import { notFound } from "next/navigation";
import PreviewClient from "./PreviewClient";

export const dynamic = "force-dynamic";

export default function PreviewSalesPage({ searchParams }: { searchParams?: { view?: string } }) {
  if (process.env.PREVIEW_FIXTURES !== "1") notFound();
  return <PreviewClient view={searchParams?.view === "inbox" ? "inbox" : "dashboard"} />;
}
