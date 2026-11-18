// /preview/jobs-calendar?mode=light|dark&view=month|week|day|schedule&cancelled=1&down=1&add=1&style=1&hq=1 (hq: the HQ view Salesperson filter, with style; add: WCT calendar add, notes + PTW + Untagged; style: calendar style chips) — the Dashboard jobs calendar
// rendered from fixtures (no sign-in, no API) for layout checks and screenshots.
// Only with PREVIEW_FIXTURES=1 in the server's environment; 404 otherwise.
import { notFound } from "next/navigation";
import PreviewClient from "./PreviewClient";

export const dynamic = "force-dynamic";

export default function PreviewJobsCalendarPage({ searchParams }: { searchParams?: Record<string, string | undefined> }) {
  if (process.env.PREVIEW_FIXTURES !== "1") notFound();
  const view = searchParams?.view === "week" ? "timeGridWeek" : searchParams?.view === "day" ? "timeGridDay" : searchParams?.view === "schedule" ? "schedule" : "dayGridMonth";
  return <PreviewClient mode={searchParams?.mode === "dark" ? "dark" : "light"} view={view} cancelled={searchParams?.cancelled === "1"} down={searchParams?.down === "1"} add={searchParams?.add === "1" || searchParams?.style === "1"} styled={searchParams?.style === "1"} hq={searchParams?.hq === "1"} />;
}
