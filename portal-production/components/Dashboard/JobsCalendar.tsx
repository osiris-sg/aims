"use client";

// Jobs calendar (WCT 2026-10-30, flag enableJobsCalendar): sits at the top of
// the Dashboard, above the org's usual dashboard sections. Scheduled deliveries,
// returns and service runs from AIMS plus every job on the org's SiteClock
// company, for the range on screen (GET /dashboard/jobs-calendar). A SiteClock
// outage shows the AIMS jobs with a banner instead of failing.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Alert, Box, Checkbox, CircularProgress, FormControl, FormControlLabel, IconButton, InputLabel, ListItemText, MenuItem, OutlinedInput, Select, Skeleton, Stack, Tooltip, Typography, useMediaQuery } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import PeopleOutlineIcon from "@mui/icons-material/PeopleOutline";
import PeoplePanel from "./jobs-calendar/PeoplePanel";
import JobFieldIcon from "@/components/jobFields/JobFieldIcon";
import { useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";
import { unwrap } from "@/app/portal/admin/organizations/_lib/siteclock-connection";
import { calendarLegendItems, filterByPeople, filterBySalesperson, legendTitle, parseHidden, peopleRows, peopleStorageKey, rangeOf, runIdOf, salespersonFilterLabel, salespersonOptions, selectAllRows, selectNoRows, siteclockBanner, toggleRow, withoutSiteClockJobs, type CalendarEvent, type CalendarPayload } from "./jobs-calendar/calendarModel";
import { useCalendarApi } from "./jobs-calendar/calendarAddApi";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { type CalendarNote } from "@/helpers/calendarAdd";
import QuickJobDialog from "./jobs-calendar/QuickJobDialog";
import { linkedToast } from "@/helpers/quickJobQuotation";
import NoteDialog from "./jobs-calendar/NoteDialog";

const CalendarView = dynamic(() => import("./jobs-calendar/CalendarView"), {
  ssr: false,
  loading: () => <Skeleton variant="rectangular" height={560} sx={{ borderRadius: 1 }} />,
});


/** fullHeight: WCT's dashboard is this calendar alone. */
export default function JobsCalendar({ fullHeight = false }: { fullHeight?: boolean }) {
  // WCT (enableWctOrders): "Job" wording, and a click opens the job.
  const { isWctOrdersEnabled, isHideSiteClockJobs, isCalendarHqView } = useOrganizationFeatures();
  const { getToken, userId } = useAuth();
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
        setData(payload ? withoutSiteClockJobs(payload, !!isHideSiteClockJobs) : payload);
        setError("");
      } catch (e: any) {
        if (latest.current === key) setError(e?.message || "Couldn't load the calendar");
      } finally {
        if (latest.current === key) setLoading(false);
      }
    })();
  }, [range, getToken, reloadKey, isHideSiteClockJobs]);

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
        salesFilter={!!isCalendarHqView || !!data?.hqView}
        peopleKey={peopleStorageKey(userId)}
      />
      {canAdd && (
        <>
          <QuickJobDialog
            open={adding?.kind === "job"}
            slot={adding?.kind === "job" ? adding.slot : null}
            onClose={() => setAdding(null)}
            withQuotation
            onSaved={(id, result) => {
              setAdding(null);
              reload();
              toast.success(linkedToast(result, result?.quotationName), { onClick: () => router.push(`/portal/deliveries/${id}`) });
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
  salesFilter = false,
  peopleKey = null,
}: {
  data: CalendarPayload | null;
  loading: boolean;
  error: string;
  showCancelled: boolean;
  onShowCancelled: (v: boolean) => void;
  onRange: (startStr: string, endStr: string) => void;
  initialDate?: string;
  initialView?: "dayGridMonth" | "timeGridWeek" | "timeGridDay" | "schedule";
  jobWords?: boolean;
  fullHeight?: boolean;
  canAdd?: boolean;
  onAdd?: (kind: "job" | "note", slot: { date: string; time: string }) => void;
  onNoteClick?: (note: CalendarNote) => void;
  /** All-day jobs (2026-11-10): drag to another day. */
  onMove?: (event: CalendarEvent, date: string) => Promise<void>;
  /** Calendar HQ view (calendarHqView): the Salesperson filter (shown with the calendar style, which carries the salesperson). */
  salesFilter?: boolean;
  /** People list (calendar style orgs): where this user's ticks are remembered in this browser (null = not kept). */
  peopleKey?: string | null;
}) {
  const banner = siteclockBanner(data);
  // Calendar style (enableCalendarStyle, WCT group): an icon legend only, and cancelled / postponed always shown (greyed).
  const styled = !!data?.style;
  // Calendar HQ view: narrow the jobs by salesperson (default All; notes always shown). Client side over the loaded range.
  const showSalesFilter = salesFilter && styled;
  const [salesSel, setSalesSel] = useState<string[]>([]);
  const knownNames = useRef(new Map<string, string>());
  const allEvents = data?.events ?? [];
  for (const e of allEvents) if (e.salesperson?.id && e.salesperson.name) knownNames.current.set(e.salesperson.id, e.salesperson.name);
  const salesOpts = useMemo(() => (showSalesFilter ? salespersonOptions(allEvents, salesSel, knownNames.current) : []), [showSalesFilter, allEvents, salesSel]);
  // People list (calendar style orgs, 2026-11-19): unticking a person hides the jobs and notes they made; a company
  // row hides that sister company's items. Everyone ticked by default; the hidden rows are remembered per user here.
  const withPeople = styled && Array.isArray(data?.people);
  const [hidden, setHidden] = useState<string[]>([]);
  useEffect(() => {
    if (!peopleKey) return;
    try {
      setHidden(parseHidden(window.localStorage.getItem(peopleKey)));
    } catch {
      setHidden([]);
    }
  }, [peopleKey]);
  const saveHidden = (next: string[]) => {
    setHidden(next);
    if (!peopleKey) return;
    try {
      window.localStorage.setItem(peopleKey, JSON.stringify(next));
    } catch {
      // Not remembered (private window or storage blocked); the ticks still apply on this page.
    }
  };
  const rows = useMemo(() => (withPeople && data ? peopleRows(data, hidden) : []), [withPeople, data, hidden]);
  const bySales = useMemo(() => (showSalesFilter ? filterBySalesperson(allEvents, salesSel) : allEvents), [showSalesFilter, allEvents, salesSel]);
  const shownEvents = useMemo(() => (withPeople ? filterByPeople(bySales, hidden) : bySales), [withPeople, bySales, hidden]);
  const shownNotes = useMemo(() => (withPeople && data?.notes ? filterByPeople(data.notes, hidden) : data?.notes), [withPeople, data, hidden]);
  const theme = useTheme();
  const wide = useMediaQuery(theme.breakpoints.up("md"));
  const [panelOpen, setPanelOpen] = useState<boolean | null>(null);
  const showPanel = withPeople && (panelOpen ?? wide);
  return (
    <Box sx={{ mb: 4, width: "100%" }}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ xs: "flex-start", sm: "center" }} justifyContent="space-between" sx={{ mb: 1.5 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          {withPeople && (
            <Tooltip title={showPanel ? "Hide people" : "Show people"}>
              <IconButton size="small" aria-label={showPanel ? "Hide people" : "Show people"} onClick={() => setPanelOpen(!showPanel)} color={showPanel ? "primary" : "default"}>
                <PeopleOutlineIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          <Typography variant="h5" sx={{ fontWeight: 600 }}>
            Jobs calendar
          </Typography>
          {showSalesFilter && (
            <FormControl size="small" sx={{ minWidth: 180 }} data-tour="jobs-calendar-salesperson-filter">
              {/* "All" shows when nothing is picked (displayEmpty), so the label always sits on the outline (shrink + notched), never over the value. */}
              <InputLabel id="jc-salesperson-label" shrink>
                Salesperson
              </InputLabel>
              <Select
                labelId="jc-salesperson-label"
                label="Salesperson"
                input={<OutlinedInput notched label="Salesperson" />}
                multiple
                displayEmpty
                value={salesSel}
                onChange={(e) => {
                  const v = typeof e.target.value === "string" ? e.target.value.split(",") : e.target.value;
                  setSalesSel(v.includes("__all__") ? [] : v);
                }}
                renderValue={(sel) => salespersonFilterLabel(sel as string[], salesOpts)}
                MenuProps={{ PaperProps: { sx: { maxHeight: 420 } } }}
              >
                <MenuItem value="__all__">
                  <Checkbox size="small" checked={!salesSel.length} />
                  <ListItemText primary="All" />
                </MenuItem>
                {salesOpts.map((o) => (
                  <MenuItem key={o.id} value={o.id}>
                    <Checkbox size="small" checked={salesSel.includes(o.id)} />
                    <ListItemText primary={o.name} />
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
          {loading && <CircularProgress size={16} />}
        </Stack>
        {styled ? (
          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap data-tour="jobs-calendar-legend">
            {data!.style!.legend.map((l) => (
              <Typography key={l.label} variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
                {`${l.icon} ${l.label}`}
              </Typography>
            ))}
          </Stack>
        ) : (
        <Stack direction="row" spacing={jobWords ? 1.5 : 2} alignItems="center" flexWrap={jobWords ? "nowrap" : "wrap"} useFlexGap>
          {calendarLegendItems(jobWords, !!data?.siteclockJobsHidden).map((l) => (
            <Stack key={l.label} direction="row" spacing={0.75} alignItems="center">
              <Box sx={{ width: 10, height: 10, borderRadius: "2px", bgcolor: l.color }} />
              <Typography variant="caption" color="text.secondary">
                {l.label}
              </Typography>
            </Stack>
          ))}
          {/* Custom job fields: what each event icon means (hover for its colours). WCT: its own short legend only. */}
          {(jobWords ? [] : data?.legend ?? []).map((l) => (
            <Tooltip key={l.fieldId} title={legendTitle(l)}>
              <Stack direction="row" spacing={0.5} alignItems="center" data-tour="jobs-calendar-field-legend">
                <JobFieldIcon icon={l.icon} sx={{ fontSize: 15, color: l.colours[0]?.colour }} />
                <Typography variant="caption" color="text.secondary">
                  {l.label}
                </Typography>
              </Stack>
            </Tooltip>
          ))}
          <FormControlLabel
            sx={{ mr: 0 }}
            control={<Checkbox size="small" checked={showCancelled} onChange={(e) => onShowCancelled(e.target.checked)} />}
            label={<Typography variant="body2">Show cancelled</Typography>}
          />
        </Stack>
        )}
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
      <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems="flex-start">
      {showPanel && <PeoplePanel rows={rows} onToggle={(id) => saveHidden(toggleRow(hidden, id))} onAll={() => saveHidden(selectAllRows())} onNone={() => saveHidden(selectNoRows(rows))} />}
      <Box sx={{ flex: 1, minWidth: 0, width: "100%" }}>
      <CalendarView
        events={shownEvents}
        showCancelled={styled || showCancelled}
        onRange={onRange}
        initialDate={initialDate}
        initialView={initialView}
        jobWords={jobWords}
        openOnClick={jobWords}
        fullHeight={fullHeight}
        notes={shownNotes}
        canAdd={canAdd}
        onAdd={onAdd}
        onNoteClick={onNoteClick}
        onMove={onMove}
        styled={styled}
        schedule={styled}
      />
      </Box>
      </Stack>
    </Box>
  );
}
