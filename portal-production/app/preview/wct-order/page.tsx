// /preview/wct-order?mode=light|dark&manual=0&kind=imported: WCT's order page (enableWctOrders) rendered from a fixture
// (no sign-in, no API) for layout checks and screenshots. manual=0: an org without the manual order flow (e.g. WCT Racking);
// kind=imported: an order imported from the old ERP on the same layout (round 24).
// Only with PREVIEW_FIXTURES=1 in the server's environment; 404 otherwise.
import { notFound } from "next/navigation";
import PreviewClient from "./PreviewClient";

export const dynamic = "force-dynamic";

export default function PreviewWctOrderPage({ searchParams }: { searchParams?: Record<string, string | undefined> }) {
  if (process.env.PREVIEW_FIXTURES !== "1") notFound();
  return <PreviewClient mode={searchParams?.mode === "dark" ? "dark" : "light"} manual={searchParams?.manual !== "0"} kind={searchParams?.kind === "imported" ? "imported" : "native"} />;
}
