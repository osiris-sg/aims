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
import { calendarLegendItems, filterByPeople, legendTitle, parseHidden, parsePanelOpen, peopleOpenKey, peopleRows, peopleStorageKey, rangeOf, runIdOf, selectAllRows, selectNoRows, siteclockBanner, toggleRow, withoutSiteClockJobs, type CalendarEvent, type CalendarPayload } from "./jobs-calendar/calendarModel";
import { useCalendarApi, useCalendarStylePeople } from "./jobs-calendar/calendarAddApi";
import CalendarFilterBar from "./jobs-calendar/CalendarFilterBar";
import ExportListDialog from "./jobs-calendar/ExportListDialog";
import type { CalendarActions } from "./jobs-calendar/StyledJobPanel";
import { NO_FILTERS, RETURN_ORG_KEY, filterEvents, parseFilters, returnOrgAction, type CalendarFilters } from "./jobs-calendar/calendarPanel";
import { ACTIVE_ORG_KEY } from "@/helpers/multiOrg";
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
  const { isWctOrdersEnabled, isHideSiteClockJobs } = useOrganizationFeatures();
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
        const res = await request({ path: `/dashboard/jobs-calendar?from=${range.from}&to=${range.to}`, method: "GET", ownError: true }, undefined, token);
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

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);
  const api = useCalendarApi();

  // Round 36: back from another company's job (opened from this calendar): this tab switches back to its company.
  useEffect(() => {
    const check = () => {
      try {
        const marker = window.sessionStorage.getItem(RETURN_ORG_KEY);
        if (!marker) return;
        window.sessionStorage.removeItem(RETURN_ORG_KEY);
        const to = returnOrgAction(marker, window.sessionStorage.getItem(ACTIVE_ORG_KEY));
        if (to === null) return;
        if (to) window.sessionStorage.setItem(ACTIVE_ORG_KEY, to);
        else window.sessionStorage.removeItem(ACTIVE_ORG_KEY);
        window.location.reload();
      } catch {
        // No sessionStorage: nothing was switched.
      }
    };
    check();
    const onShow = (ev: PageTransitionEvent) => {
      if (ev.persisted) check();
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  // Round 36 (calendar style orgs): the side panel's toggles, Cancel / Undo, Reschedule; the job categories for its pills.
  const styledOn = !!data?.style;
  const stylePeople = useCalendarStylePeople(styledOn);
  const [categories, setCategories] = useState<string[] | null>(null);
  useEffect(() => {
    if (!styledOn || categories) return;
    void api<any>("GET", "/deliveries/job-category").then((r) => setCategories(r.ok && Array.isArray(r.data?.options) ? r.data.options : []));
  }, [styledOn, categories, api]);
  const actions = useMemo<CalendarActions | undefined>(
    () =>
      styledOn
        ? {
            call: async (method, path, body, orgId) => {
              const r = await api(method, path, body, orgId);
              return { ok: r.ok, data: r.data, message: r.message };
            },
            reload,
            applicants: stylePeople.applicants,
            defaultApplicant: stylePeople.defaultApplicant,
            categories,
          }
        : undefined,
    [styledOn, api, reload, stylePeople.applicants, stylePeople.defaultApplicant, categories],
  );
  // Export list: any range (up to a month) as the calendar shows it, and the header from Settings > Job fields.
  const loadRange = useCallback(
    async (from: string, to: string): Promise<CalendarPayload | null> => {
      const token = await getToken();
      if (!token) return null;
      const res = await request({ path: `/dashboard/jobs-calendar?from=${from}&to=${to}`, method: "GET", ownError: true }, undefined, token);
      const payload = unwrap<CalendarPayload>(res, "Couldn't load the jobs");
      return payload ? withoutSiteClockJobs(payload, !!isHideSiteClockJobs) : null;
    },
    [getToken, isHideSiteClockJobs],
  );
  const loadHeader = useCallback(async () => {
    const r = await api<any>("GET", "/dashboard/calendar-style/export-header");
    return r.ok && typeof r.data?.header === "string" ? r.data.header : null;
  }, [api]);
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
        peopleKey={peopleStorageKey(userId)}
        actions={actions}
        loadRange={loadRange}
        loadHeader={loadHeader}
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
              // Saved under another company of the group: it shows on this calendar under that company (no link
              // here: opening it needs that company, like any of its jobs on this calendar).
              if (result?.orgName) toast.success(`${linkedToast(result, result.quotationName)} (${result.orgName})`);
              else toast.success(linkedToast(result, result?.quotationName), { onClick: () => router.push(`/portal/deliveries/${id}`) });
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
  peopleKey = null,
  actions,
  loadRange,
  loadHeader,
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
  /** People list (calendar style orgs): where this user's ticks are remembered in this browser (null = not kept). */
  peopleKey?: string | null;
  /** Round 36 (calendar style): the side panel's actions (absent = read only). */
  actions?: CalendarActions;
  /** Round 36: the Export list's jobs for any range, and its header line. */
  loadRange?: (from: string, to: string) => Promise<CalendarPayload | null>;
  loadHeader?: () => Promise<string | null>;
}) {
  const banner = siteclockBanner(data);
  // Calendar style (enableCalendarStyle, WCT group): an icon legend only, and cancelled / postponed always shown (greyed).
  const styled = !!data?.style;
  // The Salesperson filter (calendarHqView) was removed 2026-11-19: the people list beside the calendar does this job.
  const allEvents = useMemo(() => data?.events ?? [], [data]);
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
  // Round 36 filter bar (calendar style orgs): remembered per user in this browser, next to the people ticks.
  const filterKey = peopleKey ? peopleKey.replace(/^aims-jc-people-hidden:/, "aims-jc-filters:") : null;
  const [filters, setFiltersState] = useState<CalendarFilters>(NO_FILTERS);
  useEffect(() => {
    if (!filterKey) return;
    try {
      setFiltersState(parseFilters(window.localStorage.getItem(filterKey)));
    } catch {
      setFiltersState(NO_FILTERS);
    }
  }, [filterKey]);
  const setFilters = (f: CalendarFilters) => {
    setFiltersState(f);
    if (!filterKey) return;
    try {
      window.localStorage.setItem(filterKey, JSON.stringify(f));
    } catch {
      // Not remembered (private window or storage blocked); the filters still apply on this page.
    }
  };
  const ownOrgId = data?.group?.orgs?.[0]?.id ?? null;
  const shownEvents = useMemo(() => {
    const byPeople = withPeople ? filterByPeople(allEvents, hidden) : allEvents;
    return styled ? filterEvents(byPeople, filters, ownOrgId) : byPeople;
  }, [withPeople, allEvents, hidden, styled, filters, ownOrgId]);
  // The filter bar's choices: applicants and categories on screen plus the org's lists.
  const filterApplicants = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of actions?.applicants ?? []) m.set(a.id, a.name);
    for (const e of allEvents) if (e.ptwApplicant?.id && !m.has(e.ptwApplicant.id)) m.set(e.ptwApplicant.id, e.ptwApplicant.name || "Unknown");
    return [...m].map(([id, name]) => ({ id, name }));
  }, [actions, allEvents]);
  const filterCategories = useMemo(() => {
    const out = [...(actions?.categories ?? [])];
    for (const e of allEvents) if (e.category && !out.some((c) => c.toLowerCase() === e.category!.toLowerCase())) out.push(e.category);
    return out;
  }, [actions, allEvents]);
  const [exportOpen, setExportOpen] = useState(false);
  const exportEvents = useCallback(
    async (from: string, to: string) => {
      const p = loadRange ? await loadRange(from, to) : data;
      const list = p?.events ?? [];
      const byPeople = withPeople ? filterByPeople(list, hidden) : list;
      return filterEvents(byPeople, filters, ownOrgId);
    },
    [loadRange, data, withPeople, hidden, filters, ownOrgId],
  );
  const shownNotes = useMemo(() => (withPeople && data?.notes ? filterByPeople(data.notes, hidden) : data?.notes), [withPeople, data, hidden]);
  const theme = useTheme();
  // People panel (2026-11-19): open by default only on wide screens (1600px+), so Month gets the full width on a
  // laptop; the people icon toggles it and the choice is remembered for this user in this browser.
  const wide = useMediaQuery("(min-width:1600px)");
  const openKey = peopleOpenKey(peopleKey);
  const [panelOpen, setPanelOpenState] = useState<boolean | null>(null);
  useEffect(() => {
    if (!openKey) return;
    try {
      setPanelOpenState(parsePanelOpen(window.localStorage.getItem(openKey)));
    } catch {
      setPanelOpenState(null);
    }
  }, [openKey]);
  const setPanelOpen = (open: boolean) => {
    setPanelOpenState(open);
    if (!openKey) return;
    try {
      window.localStorage.setItem(openKey, open ? "1" : "0");
    } catch {
      // Not remembered (private window or storage blocked); the toggle still applies on this page.
    }
  };
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
          {loading && <CircularProgress size={16} />}
        </Stack>
        {/* Round 39: the calendar style legend lives in the left panel (PeoplePanel), below Companies. */}
        {styled ? null : (
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
      {styled && (
        <CalendarFilterBar
          value={filters}
          onChange={setFilters}
          applicants={filterApplicants}
          categories={filterCategories}
          companies={data?.group?.orgs ?? []}
          onExport={() => setExportOpen(true)}
        />
      )}
      {styled && <ExportListDialog open={exportOpen} onClose={() => setExportOpen(false)} loadEvents={exportEvents} loadHeader={loadHeader} />}
      <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems="flex-start">
      {showPanel && <PeoplePanel rows={rows} legend={data?.style?.legend ?? []} onToggle={(id) => saveHidden(toggleRow(hidden, id))} onAll={() => saveHidden(selectAllRows())} onNone={() => saveHidden(selectNoRows(rows))} />}
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
        actions={actions}
      />
      </Box>
      </Stack>
    </Box>
  );
}
