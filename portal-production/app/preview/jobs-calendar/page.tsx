// /preview/jobs-calendar?mode=light|dark&view=month|week|day|schedule&cancelled=1&down=1&add=1&style=1&hq=1&date=2026-11-17 (date: the day it opens on; hq: the server's HQ view flag only, its Salesperson filter was removed 2026-11-19; add: WCT calendar add, notes + PTW + Untagged; style: calendar style chips) — the Dashboard jobs calendar
// rendered from fixtures (no sign-in, no API) for layout checks and screenshots.
// Only with PREVIEW_FIXTURES=1 in the server's environment; 404 otherwise.
import { notFound } from "next/navigation";
import PreviewClient from "./PreviewClient";

export const dynamic = "force-dynamic";

export default function PreviewJobsCalendarPage({ searchParams }: { searchParams?: Record<string, string | undefined> }) {
  if (process.env.PREVIEW_FIXTURES !== "1") notFound();
  const view = searchParams?.view === "week" ? "timeGridWeek" : searchParams?.view === "day" ? "timeGridDay" : searchParams?.view === "schedule" ? "schedule" : "dayGridMonth";
  return <PreviewClient mode={searchParams?.mode === "dark" ? "dark" : "light"} view={view} cancelled={searchParams?.cancelled === "1"} down={searchParams?.down === "1"} add={searchParams?.add === "1" || searchParams?.style === "1"} styled={searchParams?.style === "1"} hq={searchParams?.hq === "1"} date={/^\d{4}-\d{2}-\d{2}$/.test(searchParams?.date ?? "") ? searchParams!.date : undefined} />;
}
