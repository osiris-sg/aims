// /preview/jobs-calendar?mode=light|dark&view=month|week|day&cancelled=1&down=1&add=1 (add: WCT calendar add, notes + PTW + Untagged) — the Dashboard jobs calendar
// rendered from fixtures (no sign-in, no API) for layout checks and screenshots.
// Only with PREVIEW_FIXTURES=1 in the server's environment; 404 otherwise.
import { notFound } from "next/navigation";
import PreviewClient from "./PreviewClient";

export const dynamic = "force-dynamic";

export default function PreviewJobsCalendarPage({ searchParams }: { searchParams?: Record<string, string | undefined> }) {
  if (process.env.PREVIEW_FIXTURES !== "1") notFound();
  const view = searchParams?.view === "week" ? "timeGridWeek" : searchParams?.view === "day" ? "timeGridDay" : "dayGridMonth";
  return <PreviewClient mode={searchParams?.mode === "dark" ? "dark" : "light"} view={view} cancelled={searchParams?.cancelled === "1"} down={searchParams?.down === "1"} add={searchParams?.add === "1"} />;
}
