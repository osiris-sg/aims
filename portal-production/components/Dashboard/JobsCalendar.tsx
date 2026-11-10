"use client";

// Jobs calendar (WCT 2026-10-30, flag enableJobsCalendar): sits at the top of
// the Dashboard, above the org's usual dashboard sections. Scheduled deliveries,
// returns and service runs from AIMS plus every job on the org's SiteClock
// company, for the range on screen (GET /dashboard/jobs-calendar). A SiteClock
// outage shows the AIMS jobs with a banner instead of failing.

import React, { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Alert, Box, Checkbox, CircularProgress, FormControlLabel, Skeleton, Stack, Tooltip, Typography } from "@mui/material";
import JobFieldIcon from "@/components/jobFields/JobFieldIcon";
import { useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";
import { unwrap } from "@/app/portal/admin/organizations/_lib/siteclock-connection";
import { calendarLegendItems, legendTitle, rangeOf, runIdOf, siteclockBanner, type CalendarEvent, type CalendarPayload } from "./jobs-calendar/calendarModel";
import { useCalendarApi } from "./jobs-calendar/calendarAddApi";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { NOTE_TYPES, type CalendarNote } from "@/helpers/calendarAdd";
import QuickJobDialog from "./jobs-calendar/QuickJobDialog";
import NoteDialog from "./jobs-calendar/NoteDialog";

const CalendarView = dynamic(() => import("./jobs-calendar/CalendarView"), {
  ssr: false,
  loading: () => <Skeleton variant="rectangular" height={560} sx={{ borderRadius: 1 }} />,
});


/** fullHeight: WCT's dashboard is this calendar alone. */
export default function JobsCalendar({ fullHeight = false }: { fullHeight?: boolean }) {
  // WCT (enableWctOrders): "Job" wording, and a click opens the job.
  const { isWctOrdersEnabled } = useOrganizationFeatures();
  const { getToken } = useAuth();
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [data, setData] = useState<CalendarPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showCancelled, setShowCancelled] = useState(false);
  const latest = useRef("");
  const router = useRouter();
  const [reloadKey, setReloadKey] = useState(0);
  // WCT calendar add: the server sends `notes` only to orgs with WCT orders + the calendar.
  const canAdd = !!isWctOrdersEnabled && Array.isArray(data?.notes);
  const [adding, setAdding] = useState<{ kind: "job" | "note"; slot: { date: string; time: string } } | null>(null);
  const [editNote, setEditNote] = useState<CalendarNote | null>(null);

  const onRange = useCallback((startStr: string, endStr: string) => {
    const r = rangeOf(startStr, endStr);
    setRange((cur) => (cur && cur.from === r.from && cur.to === r.to ? cur : r));
  }, []);

  useEffect(() => {
    if (!range) return;
    const key = `${range.from}|${range.to}`;
    latest.current = key;
    setLoading(true);
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const res = await request({ path: `/dashboard/jobs-calendar?from=${range.from}&to=${range.to}`, method: "GET" }, undefined, token);
        const payload = unwrap<CalendarPayload>(res, "Couldn't load the calendar");
        if (latest.current !== key) return; // a newer range is on screen
        setData(payload);
        setError("");
      } catch (e: any) {
        if (latest.current === key) setError(e?.message || "Couldn't load the calendar");
      } finally {
        if (latest.current === key) setLoading(false);
      }
    })();
  }, [range, getToken, reloadKey]);

  const reload = () => setReloadKey((k) => k + 1);
  const api = useCalendarApi();
  // All-day jobs (2026-11-10): a drag to another day saves at once; a refusal snaps it back.
  const onMove = useCallback(
    async (e: CalendarEvent, date: string) => {
      const id = runIdOf(e.id);
      if (!id) throw new Error("Not an AIMS job");
      const r = await api("PATCH", `/deliveries/scheduled/${id}/day`, { date });
      if (!r.ok) {
        toast.error(r.message || "Couldn't move the job");
        throw new Error(r.message);
      }
      toast.success(`${e.title} moved to ${new Date(`${date}T12:00:00+08:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}`);
      setReloadKey((k) => k + 1);
    },
    [api],
  );
  return (
    <>
      <JobsCalendarPanel
        data={data}
        loading={loading}
        error={error}
        showCancelled={showCancelled}
        onShowCancelled={setShowCancelled}
        onRange={onRange}
        jobWords={!!isWctOrdersEnabled}
        fullHeight={fullHeight}
        canAdd={canAdd}
        onAdd={(kind, slot) => setAdding({ kind, slot })}
        onNoteClick={setEditNote}
        onMove={onMove}
      />
      {canAdd && (
        <>
          <QuickJobDialog
            open={adding?.kind === "job"}
            slot={adding?.kind === "job" ? adding.slot : null}
            onClose={() => setAdding(null)}
            onSaved={(id) => {
              setAdding(null);
              reload();
              toast.success("Job added. It shows as Untagged until you link it.", { onClick: () => router.push(`/portal/deliveries/${id}`) });
            }}
          />
          <NoteDialog
            open={adding?.kind === "note" || !!editNote}
            slot={adding?.kind === "note" ? adding.slot : null}
            note={editNote}
            onClose={() => {
              setAdding(null);
              setEditNote(null);
            }}
            onSaved={() => {
              setAdding(null);
              setEditNote(null);
              reload();
            }}
          />
        </>
      )}
    </>
  );
}

/** The calendar block itself (also rendered from fixtures by /preview/jobs-calendar). */
export function JobsCalendarPanel({
  data,
  loading,
  error,
  showCancelled,
  onShowCancelled,
  onRange,
  initialDate,
  initialView,
  jobWords = false,
  fullHeight = false,
  canAdd = false,
  onAdd,
  onNoteClick,
  onMove,
}: {
  data: CalendarPayload | null;
  loading: boolean;
  error: string;
  showCancelled: boolean;
  onShowCancelled: (v: boolean) => void;
  onRange: (startStr: string, endStr: string) => void;
  initialDate?: string;
  initialView?: "dayGridMonth" | "timeGridWeek" | "timeGridDay";
  jobWords?: boolean;
  fullHeight?: boolean;
  canAdd?: boolean;
  onAdd?: (kind: "job" | "note", slot: { date: string; time: string }) => void;
  onNoteClick?: (note: CalendarNote) => void;
  /** All-day jobs (2026-11-10): drag to another day. */
  onMove?: (event: CalendarEvent, date: string) => Promise<void>;
}) {
  const banner = siteclockBanner(data);
  return (
    <Box sx={{ mb: 4 }}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ xs: "flex-start", sm: "center" }} justifyContent="space-between" sx={{ mb: 1.5 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="h5" sx={{ fontWeight: 600 }}>
            Jobs calendar
          </Typography>
          {loading && <CircularProgress size={16} />}
        </Stack>
        <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
          {calendarLegendItems(jobWords).map((l) => (
            <Stack key={l.label} direction="row" spacing={0.75} alignItems="center">
              <Box sx={{ width: 10, height: 10, borderRadius: "2px", bgcolor: l.color }} />
              <Typography variant="caption" color="text.secondary">
                {l.label}
              </Typography>
            </Stack>
          ))}
          {/* Custom job fields: what each event icon means (hover for its colours). */}
          {(data?.legend ?? []).map((l) => (
            <Tooltip key={l.fieldId} title={legendTitle(l)}>
              <Stack direction="row" spacing={0.5} alignItems="center" data-tour="jobs-calendar-field-legend">
                <JobFieldIcon icon={l.icon} sx={{ fontSize: 15, color: l.colours[0]?.colour }} />
                <Typography variant="caption" color="text.secondary">
                  {l.label}
                </Typography>
              </Stack>
            </Tooltip>
          ))}
          {/* WCT calendar add: the note colours. */}
          {canAdd &&
            NOTE_TYPES.map((t) => (
              <Stack key={t.value} direction="row" spacing={0.75} alignItems="center">
                <Box sx={{ width: 10, height: 10, borderRadius: "2px", bgcolor: t.color, opacity: 0.85 }} />
                <Typography variant="caption" color="text.secondary">
                  {t.value === "PTW" ? "PTW note" : t.label}
                </Typography>
              </Stack>
            ))}
          <FormControlLabel
            sx={{ mr: 0 }}
            control={<Checkbox size="small" checked={showCancelled} onChange={(e) => onShowCancelled(e.target.checked)} />}
            label={<Typography variant="body2">Show cancelled</Typography>}
          />
        </Stack>
      </Stack>
      {banner && (
        <Alert severity="warning" sx={{ mb: 1.5 }}>
          {banner}
        </Alert>
      )}
      {error && (
        <Alert severity="error" sx={{ mb: 1.5 }}>
          {error}
        </Alert>
      )}
      {canAdd && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
          Click an empty day or time to add a job or a note.
        </Typography>
      )}
      <CalendarView
        events={data?.events ?? []}
        showCancelled={showCancelled}
        onRange={onRange}
        initialDate={initialDate}
        initialView={initialView}
        jobWords={jobWords}
        openOnClick={jobWords}
        fullHeight={fullHeight}
        notes={data?.notes}
        canAdd={canAdd}
        onAdd={onAdd}
        onNoteClick={onNoteClick}
        onMove={onMove}
      />
    </Box>
  );
}
