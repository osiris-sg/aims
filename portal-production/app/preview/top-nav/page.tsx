// /preview/top-nav?mode=light|dark&before=1&search=1 — the two top bars' tab rows (role-home bar at the Sales
// level, and the dark bar) with NavTabsScroller, from fixtures (no sign-in, no API). before=1: the old silent
// scroll. search=1: a PROPOSAL mock only (Search collapsed to an icon that expands on click), not built in the app.
// Only with PREVIEW_FIXTURES=1 in the server's environment; 404 otherwise.
import { notFound } from "next/navigation";
import PreviewClient from "./PreviewClient";

export const dynamic = "force-dynamic";

export default function PreviewTopNavPage({ searchParams }: { searchParams?: Record<string, string | undefined> }) {
  if (process.env.PREVIEW_FIXTURES !== "1") notFound();
  return <PreviewClient mode={searchParams?.mode === "dark" ? "dark" : "light"} before={searchParams?.before === "1"} search={searchParams?.search === "1"} />;
}
