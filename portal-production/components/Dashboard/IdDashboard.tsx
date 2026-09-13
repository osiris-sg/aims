"use client";

// Interior-design dashboard (enableIdQuotation orgs, CIEL 09-01).
// Designers see THEIR numbers and leads; Management/admin see every designer.
// Revenue = contract value (signed quotation + confirmed VOs) of projects
// started this year, tracked against the manager-set yearly target.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import {
  Box, Button, Chip, CircularProgress, Grid, IconButton, LinearProgress, Paper, Stack,
  Table, TableBody, TableCell, TableHead, TableRow, Tooltip, Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import TodayIcon from "@mui/icons-material/TodayOutlined";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import MainCard from "@/components/MainCard";

const apiBase = process.env.NEXT_PUBLIC_BACKEND_API_URL;

type Row = {
  userId: string | null; name: string; ongoing: number; done: number;
  revenueYtd: number; target: number | null; projectedProfit: number; earnings: number;
  leads: { open: number; converted: number; dead: number };
};
type Payload = {
  scope: "self" | "all"; year: number; designers: Row[];
  totals: { ongoing: number; done: number; revenueYtd: number; target: number | null; projectedProfit: number; earnings: number };
  myLeads: Array<{ id: string; name: string; status: string; source: string; phone: string | null; assignedToName: string | null; firstContactDeadline: string | null; receivedAt: string }>;
  schedule: Array<{ id: string; projectId: string; projectName: string; designer: string | null; label: string; kind: string; startDate: string; endDate: string }>;
  holidays: Record<string, string>;
  holidaysMy?: Record<string, string>;
};

const money = (n: number | null | undefined) => `S$ ${new Intl.NumberFormat("en-SG", { maximumFractionDigits: 0 }).format(Number(n) || 0)}`;

function KPI({ label, value, hint, color }: { label: string; value: React.ReactNode; hint?: string; color?: string }) {
  return (
    <Paper variant="outlined" sx={{ p: 1.75, borderRadius: 2, height: "100%" }}>
      <Typography variant="overline" sx={{ color: "text.secondary", lineHeight: 1.4 }}>
        {label}
      </Typography>
      <Typography variant="h5" sx={{ fontWeight: 800, color: color || "text.primary", fontVariantNumeric: "tabular-nums" }}>
        {value}
      </Typography>
      {hint && (
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {hint}
        </Typography>
      )}
    </Paper>
  );
}

function TargetBar({ revenue, target }: { revenue: number; target: number | null }) {
  if (!target) return <Typography variant="caption" sx={{ color: "text.disabled" }}>no target set</Typography>;
  const pct = Math.min(100, (revenue / target) * 100);
  return (
    <Box sx={{ minWidth: 120 }}>
      <LinearProgress variant="determinate" value={pct} sx={{ height: 6, borderRadius: 3, mb: 0.25 }} color={pct >= 100 ? "success" : pct >= 60 ? "primary" : "warning"} />
      <Typography variant="caption" sx={{ color: "text.secondary" }}>
        {pct.toFixed(0)}% of {money(target)}
      </Typography>
    </Box>
  );
}

const DAY = 86400000;
const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (iso: string, n: number) => isoOf(new Date(new Date(iso + "T00:00:00").getTime() + n * DAY));
const fmtDay = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-SG", { day: "2-digit", month: "short" });
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
// Per-project chip colours — MUI palette colours so both themes hold up.
const PROJECT_COLORS: Array<"primary" | "warning" | "success" | "info" | "secondary" | "error"> = ["primary", "warning", "success", "info", "secondary", "error"];

/** Master calendar: every scheduled activity across the visible projects,
 *  paged two weeks at a time, one colour per project, chip → the project. */
function ScheduleOverview({ schedule, holidays, holidaysMy, self }: { schedule: Payload["schedule"]; holidays: Record<string, string>; holidaysMy: Record<string, string>; self: boolean }) {
  const router = useRouter();
  const todayIso = isoOf(new Date());
  const mondayOf = (iso: string) => addDays(iso, -((new Date(iso + "T00:00:00").getDay() + 6) % 7));
  const [weekStart, setWeekStart] = useState(() => mondayOf(isoOf(new Date())));

  const projects = useMemo(() => {
    const seen = new Map<string, string>();
    for (const it of schedule) if (!seen.has(it.projectId)) seen.set(it.projectId, it.projectName);
    return Array.from(seen.entries()).map(([id, name], i) => ({ id, name, color: PROJECT_COLORS[i % PROJECT_COLORS.length] }));
  }, [schedule]);
  const colorOf = (projectId: string) => projects.find((p) => p.id === projectId)?.color || "primary";

  const weeks = [0, 1].map((w) => [0, 1, 2, 3, 4, 5, 6].map((d) => addDays(weekStart, w * 7 + d)));
  const itemsOn = (iso: string) => schedule.filter((it) => it.startDate <= iso && it.endDate >= iso && it.kind !== "holiday");
  const windowHasItems = weeks.some((days) => days.some((iso) => itemsOn(iso).length > 0));

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, mb: 2.5, overflow: "hidden" }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 2, pt: 1.5, pb: 1, flexWrap: "wrap", rowGap: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          {self ? "My schedule" : "Schedule"}
        </Typography>
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {fmtDay(weeks[0][0])} – {fmtDay(weeks[1][6])} · all {self ? "your" : ""} projects
        </Typography>
        <Box sx={{ flex: 1 }} />
        {projects.map((p) => (
          <Chip key={p.id} size="small" color={p.color} variant="outlined" label={p.name} onClick={() => router.push(`/portal/projects/${p.id}`)} sx={{ height: 22, maxWidth: 200 }} />
        ))}
        <IconButton size="small" onClick={() => setWeekStart((w) => addDays(w, -7))} aria-label="Earlier week">
          <ChevronLeftIcon fontSize="small" />
        </IconButton>
        <Tooltip title="Back to this week">
          <IconButton size="small" onClick={() => setWeekStart(mondayOf(todayIso))} aria-label="This week">
            <TodayIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <IconButton size="small" onClick={() => setWeekStart((w) => addDays(w, 7))} aria-label="Later week">
          <ChevronRightIcon fontSize="small" />
        </IconButton>
      </Stack>
      {!windowHasItems && (
        <Typography variant="body2" sx={{ color: "text.disabled", px: 2, pb: 2 }}>
          Nothing scheduled in this window — plan activities on each project's Schedule tab, or page with the arrows.
        </Typography>
      )}
      {windowHasItems && (
        <Box sx={{ overflowX: "auto", px: 2, pb: 2 }}>
          <Box sx={{ minWidth: 900 }}>
            {weeks.map((days) => (
              <Box key={days[0]} sx={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", border: 1, borderColor: "divider", borderRadius: 1.5, overflow: "hidden", mb: 1 }}>
                {days.map((iso, di) => {
                  const isToday = iso === todayIso;
                  const sun = di === 6;
                  const holiday = holidays[iso];
                  const holidayMy = holidaysMy[iso];
                  return (
                    <Box key={iso} sx={{ borderLeft: di ? 1 : 0, borderColor: "divider", minHeight: 76, bgcolor: sun ? "action.hover" : "transparent" }}>
                      <Box sx={{ px: 0.75, py: 0.25, borderBottom: 1, borderColor: "divider", display: "flex", justifyContent: "space-between", bgcolor: isToday ? "primary.main" : "action.hover", color: isToday ? "primary.contrastText" : "text.primary" }}>
                        <Typography variant="caption" sx={{ fontWeight: 700, fontSize: 10.5 }}>
                          {DOW[di]}
                        </Typography>
                        <Typography variant="caption" sx={{ fontSize: 10.5 }}>{fmtDay(iso)}</Typography>
                      </Box>
                      <Stack spacing={0.4} sx={{ p: 0.5 }}>
                        {holiday && <Chip size="small" color="error" variant="outlined" label={holiday} sx={{ height: 18, "& .MuiChip-label": { fontSize: 9.5, px: 0.5 } }} />}
                        {holidayMy && <Chip size="small" color="error" variant="outlined" label={`MY · ${holidayMy}`} sx={{ height: 18, opacity: 0.75, "& .MuiChip-label": { fontSize: 9.5, px: 0.5 } }} />}
                        {itemsOn(iso)
                          .filter((it) => !(sun && it.kind === "work"))
                          .map((it) => (
                            <Tooltip key={it.id} title={`${it.projectName} · ${it.label} (${fmtDay(it.startDate)} – ${fmtDay(it.endDate)})${it.designer ? ` · ${it.designer}` : ""}`}>
                              <Chip
                                size="small"
                                color={colorOf(it.projectId)}
                                variant={it.kind === "note" ? "outlined" : "filled"}
                                label={it.label}
                                onClick={() => router.push(`/portal/projects/${it.projectId}`)}
                                sx={{ height: "auto", justifyContent: "flex-start", "& .MuiChip-label": { fontSize: 10, whiteSpace: "normal", px: 0.6, py: 0.2, lineHeight: 1.2 } }}
                              />
                            </Tooltip>
                          ))}
                      </Stack>
                    </Box>
                  );
                })}
              </Box>
            ))}
          </Box>
        </Box>
      )}
    </Paper>
  );
}

export default function IdDashboard() {
  const router = useRouter();
  const { getToken } = useAuth();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      const activeOrgId = typeof window !== "undefined" ? window.sessionStorage.getItem("aims-admin-active-org") : null;
      if (activeOrgId) headers["X-Active-Org-Id"] = activeOrgId;
      const res = await fetch(`${apiBase}/id-projects/dashboard`, { headers });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message?.message || json?.message || "Failed to load dashboard");
      setData(json?.data ?? json);
    } catch (e: any) {
      setError(e.message || "Failed to load dashboard");
    }
  }, [getToken]);
  useEffect(() => {
    load();
  }, [load]);

  if (error)
    return (
      <MainCard>
        <Typography color="error">{error}</Typography>
      </MainCard>
    );
  if (!data)
    return (
      <MainCard>
        <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
          <CircularProgress />
        </Box>
      </MainCard>
    );

  const self = data.scope === "self";
  const me = self ? data.designers[0] : null;
  const t = self && me ? me : data.totals;
  const deadlinePassed = (d: string | null) => d && new Date(d).getTime() < Date.now();

  return (
    <MainCard>
      <Stack direction="row" alignItems="center" sx={{ mb: 2.5 }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h4" sx={{ fontWeight: 800 }}>
            {self ? "My dashboard" : "Dashboard"}
          </Typography>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            {data.year} · {self ? "your projects and leads" : "all designers"}
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => router.push("/portal/projects?new=1")} sx={{ textTransform: "none" }} data-tour="dash-create-project">
          Create project
        </Button>
      </Stack>

      {/* KPI row */}
      <Grid container spacing={1.5} sx={{ mb: 2.5 }}>
        <Grid item xs={6} md={2.4}>
          <KPI label="Ongoing projects" value={t.ongoing} />
        </Grid>
        <Grid item xs={6} md={2.4}>
          <KPI label="Completed" value={t.done} />
        </Grid>
        <Grid item xs={6} md={2.4}>
          <KPI label={`Revenue ${data.year}`} value={money(t.revenueYtd)} hint={t.target ? `target ${money(t.target)}` : "no target set"} color={t.target && t.revenueYtd >= t.target ? "success.main" : undefined} />
        </Grid>
        <Grid item xs={6} md={2.4}>
          <KPI label="Projected profit" value={money(t.projectedProfit)} hint="contract − costs, all ongoing" />
        </Grid>
        <Grid item xs={6} md={2.4}>
          <KPI label={self ? "My earnings (projected)" : "Commissions (projected)"} value={money(t.earnings)} hint="commission % × projected profit" />
        </Grid>
      </Grid>

      {t.target != null && (
        <Paper variant="outlined" sx={{ p: 1.75, borderRadius: 2, mb: 2.5 }}>
          <Stack direction="row" alignItems="center" spacing={2}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, whiteSpace: "nowrap" }}>
              {data.year} target
            </Typography>
            <Box sx={{ flex: 1 }}>
              <LinearProgress variant="determinate" value={Math.min(100, (t.revenueYtd / t.target) * 100)} sx={{ height: 10, borderRadius: 5 }} color={t.revenueYtd >= t.target ? "success" : "primary"} />
            </Box>
            <Typography variant="body2" sx={{ fontWeight: 700, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
              {money(t.revenueYtd)} / {money(t.target)}
            </Typography>
          </Stack>
        </Paper>
      )}

      {/* Master calendar across the visible projects */}
      <ScheduleOverview schedule={data.schedule || []} holidays={data.holidays || {}} holidaysMy={data.holidaysMy || {}} self={self} />

      {/* Management: per-designer table */}
      {!self && (
        <Paper variant="outlined" sx={{ borderRadius: 2, mb: 2.5, overflow: "hidden" }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, px: 2, pt: 1.5, pb: 0.5 }}>
            Designers
          </Typography>
          <Box sx={{ overflowX: "auto" }}>
            <Table size="small" sx={{ minWidth: 860 }}>
              <TableHead>
                <TableRow>
                  <TableCell>Designer</TableCell>
                  <TableCell align="right">Ongoing</TableCell>
                  <TableCell align="right">Done</TableCell>
                  <TableCell align="right">Revenue {data.year}</TableCell>
                  <TableCell>Vs target</TableCell>
                  <TableCell align="right">Projected profit</TableCell>
                  <TableCell align="right">Earnings</TableCell>
                  <TableCell align="right">Leads open / won / dead</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.designers.map((r) => (
                  <TableRow key={r.userId || r.name} hover>
                    <TableCell sx={{ fontWeight: 600 }}>{r.name}</TableCell>
                    <TableCell align="right">{r.ongoing}</TableCell>
                    <TableCell align="right">{r.done}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>{money(r.revenueYtd)}</TableCell>
                    <TableCell>
                      <TargetBar revenue={r.revenueYtd} target={r.target} />
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>{money(r.projectedProfit)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>{money(r.earnings)}</TableCell>
                    <TableCell align="right">
                      {r.leads.open} / {r.leads.converted} / {r.leads.dead}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </Paper>
      )}

      {/* Open leads (mine for designers, org-wide for management) */}
      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
        <Stack direction="row" alignItems="center" sx={{ px: 2, pt: 1.5, pb: 0.5 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, flex: 1 }}>
            {self ? "My open leads" : "Open leads"}
          </Typography>
          <Button size="small" endIcon={<OpenInNewIcon />} onClick={() => router.push("/portal/sales/leads")} sx={{ textTransform: "none" }}>
            All leads
          </Button>
        </Stack>
        {data.myLeads.length === 0 ? (
          <Typography variant="body2" sx={{ color: "text.disabled", px: 2, py: 2 }}>
            Nothing open — new leads land here automatically.
          </Typography>
        ) : (
          <Box sx={{ overflowX: "auto" }}>
            <Table size="small" sx={{ minWidth: 640 }}>
              <TableHead>
                <TableRow>
                  <TableCell>Lead</TableCell>
                  <TableCell>Source</TableCell>
                  <TableCell>Status</TableCell>
                  {!self && <TableCell>Assigned</TableCell>}
                  <TableCell>Received</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {data.myLeads.map((l) => (
                  <TableRow key={l.id} hover>
                    <TableCell sx={{ fontWeight: 600 }}>{l.name}</TableCell>
                    <TableCell>
                      <Chip size="small" variant="outlined" label={(l.source || "manual").toUpperCase()} sx={{ height: 20 }} />
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5}>
                        <Chip size="small" color={l.status === "engaging" ? "info" : "primary"} variant="outlined" label={l.status} sx={{ height: 20 }} />
                        {l.status === "unqualified" && l.firstContactDeadline && (
                          <Chip size="small" color={deadlinePassed(l.firstContactDeadline) ? "error" : "warning"} label={deadlinePassed(l.firstContactDeadline) ? "24h missed" : "contact <24h"} sx={{ height: 20 }} />
                        )}
                      </Stack>
                    </TableCell>
                    {!self && <TableCell>{l.assignedToName || "—"}</TableCell>}
                    <TableCell>
                      <Typography variant="caption">{new Date(l.receivedAt).toLocaleDateString("en-SG", { day: "2-digit", month: "short" })}</Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Button size="small" onClick={() => router.push("/portal/sales/leads")} sx={{ textTransform: "none" }}>
                        Open
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
      </Paper>
    </MainCard>
  );
}
