"use client";

// Interior-design dashboard (enableIdQuotation orgs, CIEL 09-01).
// Designers see THEIR numbers and leads; Management/admin see every designer.
// Revenue = contract value (signed quotation + confirmed VOs) of projects
// started this year, tracked against the manager-set yearly target.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SignatureCanvas from "react-signature-canvas";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import {
  Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, Grid, IconButton, LinearProgress, MenuItem, Paper, Stack, Switch,
  Table, TableBody, TableCell, TableHead, TableRow, TextField, Tooltip, Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import TodayIcon from "@mui/icons-material/TodayOutlined";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import MainCard from "@/components/MainCard";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";

const apiBase = process.env.NEXT_PUBLIC_BACKEND_API_URL;

type Row = {
  userId: string | null; name: string; ongoing: number; done: number;
  revenueYtd: number; target: number | null; projectedProfit: number; earnings: number;
  leads: { open: number; converted: number; dead: number };
};
type Payload = {
  scope: "self" | "team" | "all"; year: number; designers: Row[];
  team?: { name: string; target: number | null; revenueYtd: number; projectedProfit: number; members: number } | null;
  funnel?: { notSigned: number; signed: number; inWorks: number; completed: number };
  totals: { ongoing: number; done: number; revenueYtd: number; target: number | null; projectedProfit: number; earnings: number };
  myLeads: Array<{ id: string; name: string; status: string; source: string; phone: string | null; assignedToName: string | null; firstContactDeadline: string | null; receivedAt: string }>;
  schedule: Array<{ id: string; projectId: string; projectName: string; designer: string | null; label: string; kind: string; startDate: string; endDate: string }>;
  reviewNotes?: Array<{ projectId: string; projectName: string; stage: string | null; note: string }>;
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
// Lead appointments ride the calendar with pseudo-project ids "lead:<id>".
const scheduleRoute = (projectId: string) => (projectId.startsWith("lead:") ? "/portal/sales/leads" : `/portal/projects/${projectId}`);
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
          <Chip key={p.id} size="small" color={p.color} variant="outlined" label={p.name} onClick={() => router.push(scheduleRoute(p.id))} sx={{ height: 22, maxWidth: 200 }} />
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
      {/* The grid always renders — an empty fortnight still looks like a
          calendar, with a hint line instead of a collapsed card (guru 2026-09-24). */}
      {!windowHasItems && (
        <Typography variant="caption" sx={{ color: "text.disabled", px: 2, display: "block", pb: 1 }}>
          Nothing scheduled in this window — plan activities on each project's Schedule tab, or page with the arrows.
        </Typography>
      )}
      {(
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
                                onClick={() => router.push(scheduleRoute(it.projectId))}
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

/**
 * Designer advances (guru 2026-10-06, enableDesignerAdvances orgs): designers
 * request money ahead of commission; Senior Management approves/declines and
 * later stamps the payout. Designers see their own requests; seniors see all
 * pending ones with the decision buttons.
 */
function AdvancesCard({ self }: { self: boolean }) {
  const { getToken } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [canDecide, setCanDecide] = useState(false);
  const [canEditDates, setCanEditDates] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ amount: "", projectId: "", reason: "" });
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  // Approval dialog (signature required) + Director-only date editor.
  const [approveFor, setApproveFor] = useState<any>(null);
  const [approveNote, setApproveNote] = useState("");
  const [dateEdit, setDateEdit] = useState<any>(null);
  const [dateForm, setDateForm] = useState({ requestedAt: "", decidedAt: "" });
  const requestSigRef = useRef<any>(null);
  const approveSigRef = useRef<any>(null);
  // Saved signature (guru 2026-10-08): kept on THIS device only (localStorage),
  // never uploaded until it is used to sign something.
  const SIG_KEY = "aims-saved-signature";
  const [savedSig, setSavedSig] = useState<string | null>(null);
  const [rememberSig, setRememberSig] = useState(false);
  useEffect(() => {
    try {
      setSavedSig(window.localStorage.getItem(SIG_KEY));
    } catch {
      /* private mode */
    }
  }, []);
  // Which canvas currently shows the SAVED signature. fromDataURL stretches
  // the image to the canvas, so re-exporting it grows the signature every
  // round-trip (guru 2026-10-10) — when the flag is set we submit the stored
  // PNG verbatim instead of re-reading the canvas. Drawing or Clear resets it.
  const usedSavedRef = useRef<{ req: boolean; app: boolean }>({ req: false, app: false });
  const useSavedOn = (ref: React.MutableRefObject<any>, which: "req" | "app") => {
    if (!savedSig || !ref.current) return;
    ref.current.clear();
    ref.current.fromDataURL(savedSig);
    usedSavedRef.current[which] = true;
  };
  const maybeRemember = (dataUrl: string) => {
    if (!rememberSig) return;
    try {
      window.localStorage.setItem(SIG_KEY, dataUrl);
      setSavedSig(dataUrl);
    } catch {
      /* ignore */
    }
  };

  const headers = useCallback(async () => {
    const token = await getToken();
    const h: Record<string, string> = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const activeOrgId = typeof window !== "undefined" ? window.sessionStorage.getItem("aims-admin-active-org") : null;
    if (activeOrgId) h["X-Active-Org-Id"] = activeOrgId;
    return h;
  }, [getToken]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/advances`, { headers: await headers() });
      if (!res.ok) return;
      const j = await res.json();
      const payload = j?.data ?? j;
      setRows(payload?.rows || []);
      setByDesigner(payload?.byDesigner || []);
      setCanDecide(!!payload?.viewer?.canDecide);
      setCanEditDates(!!payload?.viewer?.canEditDates);
    } catch {
      /* card is optional */
    }
  }, [headers]);
  useEffect(() => {
    load();
  }, [load]);

  const openDialog = async () => {
    setOpen(true);
    try {
      const res = await fetch(`${apiBase}/id-projects?limit=100`, { headers: await headers() });
      const j = await res.json();
      const payload = j?.data ?? j;
      const list = payload?.docs || payload?.rows || (Array.isArray(payload) ? payload : []);
      setProjects(list.map((p: any) => ({ id: p.id, name: p.name })));
    } catch {
      setProjects([]);
    }
  };

  const submit = async () => {
    const amount = Number(form.amount);
    if (!(amount > 0)) return;
    if (!requestSigRef.current || requestSigRef.current.isEmpty()) {
      alert("Please sign the request");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${apiBase}/advances`, {
        method: "POST",
        headers: await headers(),
        body: (() => {
          const sig = usedSavedRef.current.req && savedSig ? savedSig : requestSigRef.current.getTrimmedCanvas().toDataURL("image/png");
          if (!usedSavedRef.current.req) maybeRemember(sig);
          return JSON.stringify({ amount, projectId: form.projectId || null, reason: form.reason || null, signature: sig });
        })(),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.message?.message || j?.message || "Could not submit the request");
      }
      setOpen(false);
      setForm({ amount: "", projectId: "", reason: "" });
      load();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  const act = async (id: string, path: string, body?: any) => {
    setBusy(true);
    try {
      await fetch(`${apiBase}/advances/${id}/${path}`, { method: "PATCH", headers: await headers(), body: body ? JSON.stringify(body) : undefined });
      load();
    } finally {
      setBusy(false);
    }
  };

  // Per-designer advances summary (guru 2026-10-10): who has taken how much,
  // at a glance — click a designer to see the per-project split.
  const [byDesigner, setByDesigner] = useState<any[]>([]);
  const [openDesigner, setOpenDesigner] = useState<string | null>(null);

  const pending = rows.filter((r) => r.status === "pending");
  const recent = rows.filter((r) => r.status !== "pending").slice(0, 5);
  const statusColor: Record<string, "default" | "warning" | "success" | "error" | "info"> = { pending: "warning", approved: "info", paid: "success", declined: "error" };

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, mb: 2.5, p: 2 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          {self ? "My advances" : "Advance requests"}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={openDialog} sx={{ textTransform: "none" }} data-tour="request-advance">
          Request advance
        </Button>
      </Stack>
      {pending.length === 0 && recent.length === 0 && (
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          No advance requests yet. An approved advance is paid with the bi-weekly run and nets off against commission at handover.
        </Typography>
      )}
      {byDesigner.length > 0 && (
        <Box sx={{ mb: 1.5, p: 1, borderRadius: 1, bgcolor: "action.hover" }}>
          <Typography variant="caption" sx={{ fontWeight: 700, color: "text.secondary", display: "block", mb: 0.5 }}>
            {self ? "My advances summary" : "Advances by designer"}
          </Typography>
          <Stack spacing={0.25}>
            {byDesigner.map((d: any) => (
              <Box key={d.designerId}>
                <Stack
                  direction="row"
                  alignItems="center"
                  spacing={1}
                  onClick={() => setOpenDesigner((v) => (v === d.designerId ? null : d.designerId))}
                  sx={{ cursor: d.projects?.length ? "pointer" : "default", flexWrap: "wrap", rowGap: 0.25 }}
                >
                  <Typography variant="body2" sx={{ fontWeight: 700, minWidth: 130 }} noWrap>
                    {d.designerName}
                  </Typography>
                  <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>
                    {money(d.advanced)}
                  </Typography>
                  <Typography variant="caption" sx={{ color: "text.secondary", fontVariantNumeric: "tabular-nums" }}>
                    advanced ({d.count} request{d.count === 1 ? "" : "s"}) · paid out {money(d.paid)}
                    {d.pending > 0 ? ` · ${money(d.pending)} pending` : ""}
                  </Typography>
                  {d.projects?.length > 0 && (
                    <Typography variant="caption" sx={{ color: "primary.main" }}>
                      {openDesigner === d.designerId ? "hide projects" : `${d.projects.length} project${d.projects.length === 1 ? "" : "s"}`}
                    </Typography>
                  )}
                </Stack>
                {openDesigner === d.designerId && (
                  <Stack spacing={0} sx={{ pl: 2, pb: 0.5 }}>
                    {d.projects.map((pj: any) => (
                      <Stack key={pj.name} direction="row" spacing={1} alignItems="baseline">
                        <Typography variant="caption" sx={{ color: "text.secondary", flex: 1 }} noWrap>
                          {pj.name}
                        </Typography>
                        <Typography variant="caption" sx={{ fontVariantNumeric: "tabular-nums" }}>{money(pj.amount)}</Typography>
                      </Stack>
                    ))}
                  </Stack>
                )}
              </Box>
            ))}
          </Stack>
        </Box>
      )}
      <Stack spacing={0.75}>
        {[...pending, ...recent].map((r) => (
          <Stack key={r.id} direction="row" alignItems="center" spacing={1} sx={{ flexWrap: "wrap", rowGap: 0.5 }}>
            <Chip size="small" label={r.status} color={statusColor[r.status] || "default"} variant="outlined" sx={{ height: 20, textTransform: "capitalize" }} />
            <Typography variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{money(r.amount)}</Typography>
            <Typography variant="body2" sx={{ color: "text.secondary", flex: 1, minWidth: 160 }} noWrap>
              {!self && (r.requestedByName || "—")}{!self && " · "}{r.projectName || "no project"}{r.reason ? ` — ${r.reason}` : ""}
            </Typography>
            <Typography variant="caption" sx={{ color: "text.disabled", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
              requested {new Date(r.createdAt).toLocaleDateString("en-SG", { day: "2-digit", month: "short" })}
              {r.decidedAt ? ` · ${r.status === "declined" ? "declined" : "approved"} ${new Date(r.decidedAt).toLocaleDateString("en-SG", { day: "2-digit", month: "short" })}` : ""}
            </Typography>
            {r.requestSignature && <Box component="img" src={r.requestSignature} alt="requester signature" sx={{ height: 22, maxWidth: 80, objectFit: "contain", bgcolor: "#fff", borderRadius: 0.5, px: 0.25 }} />}
            {r.approveSignature && <Box component="img" src={r.approveSignature} alt="approver signature" sx={{ height: 22, maxWidth: 80, objectFit: "contain", bgcolor: "#fff", borderRadius: 0.5, px: 0.25 }} />}
            {canEditDates && (
              <Button size="small" disabled={busy} onClick={() => { setDateEdit(r); setDateForm({ requestedAt: (r.createdAt || "").slice(0, 10), decidedAt: (r.decidedAt || "").slice(0, 10) }); }} sx={{ textTransform: "none", minWidth: 0, px: 0.5, color: "text.secondary" }}>
                Edit dates
              </Button>
            )}
            {canDecide && r.status === "pending" && (
              <>
                <Button size="small" disabled={busy} onClick={() => { setApproveNote(""); setApproveFor(r); }} sx={{ textTransform: "none" }}>
                  Approve
                </Button>
                <Button size="small" color="error" disabled={busy} onClick={() => { const note = window.prompt("Reason for declining (optional)") || undefined; act(r.id, "decide", { approve: false, note }); }} sx={{ textTransform: "none" }}>
                  Decline
                </Button>
              </>
            )}
            {canDecide && r.status === "approved" && (
              <Button size="small" disabled={busy} onClick={() => act(r.id, "paid")} sx={{ textTransform: "none" }}>
                Mark paid
              </Button>
            )}
          </Stack>
        ))}
      </Stack>

      {/* Approve with signature (guru 2026-10-07: management signs the approval) */}
      <Dialog open={!!approveFor} onClose={() => setApproveFor(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Approve advance — {approveFor ? money(approveFor.amount) : ""}</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ mt: 0.5 }}>
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              {approveFor?.requestedByName || "Designer"} · {approveFor?.projectName || "no project"}{approveFor?.reason ? ` — ${approveFor.reason}` : ""}
            </Typography>
            <TextField label="Note (optional)" size="small" value={approveNote} onChange={(e) => setApproveNote(e.target.value)} fullWidth />
            <Box>
              <Typography variant="caption" sx={{ color: "text.secondary" }}>Sign to approve</Typography>
              <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, bgcolor: "#fff" }}>
                <SignatureCanvas ref={approveSigRef} penColor="#1a237e" onBegin={() => (usedSavedRef.current.app = false)} canvasProps={{ style: { width: "100%", height: 120 } }} />
              </Box>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: "wrap" }}>
                <Button size="small" onClick={() => { approveSigRef.current?.clear(); usedSavedRef.current.app = false; }} sx={{ textTransform: "none", color: "text.secondary" }}>
                  Clear
                </Button>
                {savedSig && (
                  <Button size="small" onClick={() => useSavedOn(approveSigRef, "app")} sx={{ textTransform: "none" }}>
                    Use saved signature
                  </Button>
                )}
                <FormControlLabel
                  control={<Switch size="small" checked={rememberSig} onChange={(e) => setRememberSig(e.target.checked)} />}
                  label={<Typography variant="caption">Remember on this device</Typography>}
                  sx={{ mr: 0 }}
                />
              </Stack>
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setApproveFor(null)} sx={{ textTransform: "none" }}>Cancel</Button>
          <Button
            variant="contained"
            disabled={busy}
            onClick={async () => {
              if (!approveSigRef.current || approveSigRef.current.isEmpty()) return alert("Please sign to approve");
              const sig = usedSavedRef.current.app && savedSig ? savedSig : approveSigRef.current.getTrimmedCanvas().toDataURL("image/png");
              if (!usedSavedRef.current.app) maybeRemember(sig);
              await act(approveFor.id, "decide", { approve: true, note: approveNote || undefined, signature: sig });
              setApproveFor(null);
            }}
            sx={{ textTransform: "none" }}
          >
            Approve
          </Button>
        </DialogActions>
      </Dialog>

      {/* Director-only date editor (guru 2026-10-07) */}
      <Dialog open={!!dateEdit} onClose={() => setDateEdit(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Edit advance dates</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <TextField label="Requested on" type="date" size="small" InputLabelProps={{ shrink: true }} value={dateForm.requestedAt} onChange={(e) => setDateForm({ ...dateForm, requestedAt: e.target.value })} fullWidth />
            <TextField label="Approved / declined on" type="date" size="small" InputLabelProps={{ shrink: true }} value={dateForm.decidedAt} onChange={(e) => setDateForm({ ...dateForm, decidedAt: e.target.value })} fullWidth />
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              Directors only — use for back-dating a request that was made on paper first.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDateEdit(null)} sx={{ textTransform: "none" }}>Cancel</Button>
          <Button
            variant="contained"
            disabled={busy}
            onClick={async () => {
              await act(dateEdit.id, "dates", { requestedAt: dateForm.requestedAt || null, decidedAt: dateForm.decidedAt || null });
              setDateEdit(null);
            }}
            sx={{ textTransform: "none" }}
          >
            Save dates
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Request an advance</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <TextField label="Amount (S$)" size="small" value={form.amount} onChange={(e) => /^[0-9]*\.?[0-9]*$/.test(e.target.value) && setForm({ ...form, amount: e.target.value })} inputProps={{ inputMode: "decimal" }} autoFocus fullWidth />
            <TextField label="Project (optional)" size="small" select value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })} fullWidth>
              <MenuItem value="">No specific project</MenuItem>
              {projects.map((p) => (
                <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>
              ))}
            </TextField>
            <TextField label="Reason (optional)" size="small" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} multiline minRows={2} fullWidth />
            <Box>
              <Typography variant="caption" sx={{ color: "text.secondary" }}>Your signature</Typography>
              <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, bgcolor: "#fff" }}>
                <SignatureCanvas ref={requestSigRef} penColor="#1a237e" onBegin={() => (usedSavedRef.current.req = false)} canvasProps={{ style: { width: "100%", height: 120 } }} />
              </Box>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: "wrap" }}>
                <Button size="small" onClick={() => { requestSigRef.current?.clear(); usedSavedRef.current.req = false; }} sx={{ textTransform: "none", color: "text.secondary" }}>
                  Clear
                </Button>
                {savedSig && (
                  <Button size="small" onClick={() => useSavedOn(requestSigRef, "req")} sx={{ textTransform: "none" }}>
                    Use saved signature
                  </Button>
                )}
                <FormControlLabel
                  control={<Switch size="small" checked={rememberSig} onChange={(e) => setRememberSig(e.target.checked)} />}
                  label={<Typography variant="caption">Remember on this device</Typography>}
                  sx={{ mr: 0 }}
                />
              </Stack>
            </Box>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              Goes to Senior Management for approval. Approved advances net off against your commission at handover.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} sx={{ textTransform: "none" }}>Cancel</Button>
          <Button variant="contained" disabled={busy || !(Number(form.amount) > 0)} onClick={submit} sx={{ textTransform: "none" }}>
            Submit request
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}

/**
 * Appointment schedule (guru 2026-10-08, enableAppointmentBooking orgs): the
 * DESIGNER's own calendar — appointments they add, client self-bookings from
 * their public /book link, and their lead appointments, in one list. Managers
 * see every designer's. The booking link shows clients FREE slots only.
 */
function AppointmentsCard({ self }: { self: boolean }) {
  const { getToken } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ title: "", phone: "", location: "", note: "", date: "", time: "" });
  const [link, setLink] = useState<string | null>(null);

  const headers = useCallback(async () => {
    const token = await getToken();
    const h: Record<string, string> = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const activeOrgId = typeof window !== "undefined" ? window.sessionStorage.getItem("aims-admin-active-org") : null;
    if (activeOrgId) h["X-Active-Org-Id"] = activeOrgId;
    return h;
  }, [getToken]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/appointments`, { headers: await headers() });
      if (!res.ok) return;
      const j = await res.json();
      const payload = j?.data ?? j;
      const all = [...(payload?.appointments || []), ...(payload?.leadAppointments || [])]
        .filter((a: any) => new Date(a.endAt || a.startAt) >= new Date())
        .sort((a: any, b: any) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
      setRows(all);
    } catch {
      /* optional card */
    }
  }, [headers]);
  useEffect(() => {
    load();
  }, [load]);

  const shareLink = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${apiBase}/appointments/booking-link`, { method: "POST", headers: await headers() });
      const j = await res.json();
      const payload = j?.data ?? j;
      const url = /^https?:/i.test(payload.url) ? payload.url : `${window.location.origin}${payload.path}`;
      setLink(url);
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        /* clipboard may be blocked */
      }
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!form.title.trim() || !form.date || !form.time) return;
    setBusy(true);
    try {
      const startAt = new Date(`${form.date}T${form.time}:00+08:00`).toISOString();
      const res = await fetch(`${apiBase}/appointments`, {
        method: "POST",
        headers: await headers(),
        body: JSON.stringify({ title: form.title.trim(), phone: form.phone || null, location: form.location || null, note: form.note || null, startAt }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.message?.message || j?.message || "Could not add the appointment");
      }
      setOpen(false);
      setForm({ title: "", phone: "", location: "", note: "", date: "", time: "" });
      load();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (id: string) => {
    if (!window.confirm("Cancel this appointment?")) return;
    setBusy(true);
    try {
      await fetch(`${apiBase}/appointments/${id}/cancel`, { method: "PATCH", headers: await headers() });
      load();
    } finally {
      setBusy(false);
    }
  };

  const fmt = (iso: string) => new Date(iso).toLocaleString("en-SG", { timeZone: "Asia/Singapore", weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  const srcChip: Record<string, { label: string; color: "default" | "success" | "info" | "warning" }> = {
    client: { label: "booked by client", color: "success" },
    lead: { label: "lead", color: "info" },
    block: { label: "blocked", color: "default" },
    designer: { label: "own", color: "default" },
  };

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, mb: 2.5, p: 2 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1, flexWrap: "wrap", rowGap: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          {self ? "My appointments" : "Appointments"}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Button size="small" variant="outlined" disabled={busy} onClick={shareLink} sx={{ textTransform: "none" }}>
          Share booking link
        </Button>
        <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={() => setOpen(true)} sx={{ textTransform: "none" }} data-tour="add-appointment">
          Add appointment
        </Button>
      </Stack>
      {link && (
        <Typography variant="caption" sx={{ display: "block", mb: 1, color: "text.secondary", wordBreak: "break-all" }}>
          Booking link copied — clients see only your free slots: {link}{" "}
          <Typography component="a" variant="caption" href={`https://wa.me/?text=${encodeURIComponent(`Book an appointment with me here: ${link}`)}`} target="_blank" rel="noreferrer" sx={{ color: "primary.main" }}>
            Share on WhatsApp
          </Typography>
        </Typography>
      )}
      {rows.length === 0 && (
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          Nothing upcoming. Add an appointment, or share your booking link and let clients pick a free slot themselves.
        </Typography>
      )}
      <Stack spacing={0.5}>
        {rows.slice(0, 10).map((a: any) => (
          <Stack key={a.id} direction="row" alignItems="center" spacing={1} sx={{ flexWrap: "wrap", rowGap: 0.25 }}>
            <Typography variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums", minWidth: 150 }}>
              {fmt(a.startAt)}
            </Typography>
            <Typography variant="body2" sx={{ flex: 1, minWidth: 140 }} noWrap>
              {a.title}
              {!self && a.designerName ? ` · ${a.designerName}` : ""}
              {a.location ? ` — ${a.location}` : ""}
            </Typography>
            <Chip size="small" variant="outlined" color={srcChip[a.source]?.color || "default"} label={srcChip[a.source]?.label || a.source} sx={{ height: 18, "& .MuiChip-label": { px: 0.6, fontSize: 10 } }} />
            {!String(a.id).startsWith("lead:") && (
              <IconButton size="small" disabled={busy} onClick={() => cancel(a.id)} sx={{ color: "text.disabled", "&:hover": { color: "error.main" } }} aria-label="Cancel appointment">
                ✕
              </IconButton>
            )}
          </Stack>
        ))}
      </Stack>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Add appointment</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <TextField label="Client / purpose" size="small" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} autoFocus fullWidth />
            <Stack direction="row" spacing={1}>
              <TextField label="Date" type="date" size="small" InputLabelProps={{ shrink: true }} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} fullWidth />
              <TextField label="Time" type="time" size="small" InputLabelProps={{ shrink: true }} value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} fullWidth />
            </Stack>
            <TextField label="Phone (optional)" size="small" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} fullWidth />
            <TextField label="Location (optional)" size="small" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} fullWidth />
            <TextField label="Note (optional)" size="small" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} fullWidth />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} sx={{ textTransform: "none" }}>Cancel</Button>
          <Button variant="contained" disabled={busy || !form.title.trim() || !form.date || !form.time} onClick={submit} sx={{ textTransform: "none" }}>
            Add
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}

export default function IdDashboard() {
  const router = useRouter();
  const { getToken, userId } = useAuth();
  const { isDesignerAdvancesEnabled, isAppointmentBookingEnabled } = useOrganizationFeatures();
  const [data, setData] = useState<Payload | null>(null);
  const [rebates, setRebates] = useState<any>(null);
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
      const payload = json?.data ?? json;
      setData(payload);
      // Supplier rebates — management only; designers (and older servers) 404
      // and the card simply doesn't render.
      if (payload?.scope === "all") {
        fetch(`${apiBase}/projects/rebates/overview`, { headers })
          .then(async (r) => {
            if (!r.ok) return;
            const j = await r.json();
            setRebates(j?.data ?? j);
          })
          .catch(() => null);
      }
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
  // Managers/leaders also sell — split THEIR personal numbers out of the
  // org/team overall (guru 2026-09-19: "segregate overall vs my own revenue").
  const myRow = !self ? data.designers.find((r) => r.userId && r.userId === userId) || null : null;
  const deadlinePassed = (d: string | null) => d && new Date(d).getTime() < Date.now();

  return (
    <MainCard>
      <Stack direction="row" alignItems="center" useFlexGap sx={{ mb: 2.5, flexWrap: { xs: "wrap", md: "nowrap" }, gap: 1 }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h4" sx={{ fontWeight: 800 }}>
            {self ? "My dashboard" : data.scope === "team" ? `${data.team?.name || "Team"} dashboard` : "Dashboard"}
          </Typography>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            {data.year} · {self ? "your projects and leads" : data.scope === "team" ? `your team (${data.team?.members || 0} members)` : "all designers"}
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => router.push("/portal/projects?new=1")} sx={{ textTransform: "none" }} data-tour="dash-create-project">
          Create project
        </Button>
      </Stack>

      {/* KPI row */}
      <Grid container spacing={1.5} sx={{ mb: 2.5 }}>
        <Grid item xs={6} md={2.4}>
          <KPI
            label="Ongoing projects"
            value={t.ongoing}
            // "Ongoing" here = every open job. The breakdown mirrors the
            // Projects page funnel chips (guru 2026-10-01: 4 vs 2 confusion).
            hint={data.funnel ? [data.funnel.notSigned ? `${data.funnel.notSigned} not signed` : null, data.funnel.signed ? `${data.funnel.signed} signed` : null, data.funnel.inWorks ? `${data.funnel.inWorks} in works` : null].filter(Boolean).join(" · ") || undefined : undefined}
          />
        </Grid>
        <Grid item xs={6} md={2.4}>
          <KPI label="Completed" value={t.done} />
        </Grid>
        <Grid item xs={6} md={2.4}>
          <KPI
            label={`Revenue ${data.year}`}
            value={money(t.revenueYtd)}
            hint={
              t.target
                ? self
                  ? `target ${money(t.target)}`
                  : `target ${money(t.target)} · ${data.designers.filter((r) => r.target != null).length} designers combined${myRow ? ` · you: ${money(myRow.revenueYtd)}` : ""}`
                : "no target set"
            }
            color={t.target && t.revenueYtd >= t.target ? "success.main" : undefined}
          />
        </Grid>
        <Grid item xs={6} md={2.4}>
          <KPI label="Projected profit" value={money(t.projectedProfit)} hint="contract − costs, all ongoing" />
        </Grid>
        <Grid item xs={6} md={2.4}>
          <KPI label={self ? "My earnings (projected)" : "Commissions (projected)"} value={money(t.earnings)} hint="commission % × projected profit" />
        </Grid>
      </Grid>

      {/* Junior Manager: the TEAM bubble — team revenue vs the TEAM target,
          separate from personal numbers (hierarchy access, guru 2026-09-19). */}
      {data.scope === "team" && data.team && (
        <Paper variant="outlined" sx={{ p: 1.75, borderRadius: 2, mb: 2.5, borderColor: "primary.main" }} data-tour="dash-team-bubble">
          <Stack direction="row" alignItems="center" spacing={2} flexWrap="wrap" useFlexGap>
            <Box>
              <Typography variant="overline" sx={{ color: "text.secondary", lineHeight: 1.4 }}>
                Team revenue {data.year}
              </Typography>
              <Typography variant="h5" sx={{ fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
                {money(data.team.revenueYtd)}
              </Typography>
            </Box>
            <Box sx={{ flex: 1, minWidth: 220 }}>
              {data.team.target ? (
                <>
                  <LinearProgress variant="determinate" value={Math.min(100, (data.team.revenueYtd / data.team.target) * 100)} sx={{ height: 10, borderRadius: 5 }} color={data.team.revenueYtd >= data.team.target ? "success" : "primary"} />
                  <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    team target {money(data.team.target)} · {Math.min(100, (data.team.revenueYtd / data.team.target) * 100).toFixed(0)}%
                  </Typography>
                </>
              ) : (
                <Typography variant="caption" sx={{ color: "text.disabled" }}>
                  no team target set — ask management to set it in User Management → Teams
                </Typography>
              )}
            </Box>
            <Box sx={{ textAlign: "right" }}>
              <Typography variant="overline" sx={{ color: "text.secondary", lineHeight: 1.4 }}>
                Team projected profit
              </Typography>
              <Typography variant="h6" sx={{ fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
                {money(data.team.projectedProfit)}
              </Typography>
            </Box>
          </Stack>
        </Paper>
      )}

      {(t.target != null || myRow) && (
        <Paper variant="outlined" sx={{ p: 1.75, borderRadius: 2, mb: 2.5 }}>
          <Stack spacing={1.25}>
            {t.target != null && (
              // Phone: label / bar / numbers wrap instead of crushing the bar
              <Stack direction="row" alignItems="center" spacing={2} sx={{ flexWrap: { xs: "wrap", sm: "nowrap" }, rowGap: 0.5 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, whiteSpace: "nowrap", minWidth: 170 }}>
                  {data.year} target{self ? "" : data.scope === "team" ? " (team)" : " (all designers)"}
                </Typography>
                <Box sx={{ flex: 1, minWidth: 120 }}>
                  <LinearProgress variant="determinate" value={Math.min(100, (t.revenueYtd / t.target) * 100)} sx={{ height: 10, borderRadius: 5 }} color={t.revenueYtd >= t.target ? "success" : "primary"} />
                </Box>
                <Typography variant="body2" sx={{ fontWeight: 700, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                  {money(t.revenueYtd)} / {money(t.target)}
                </Typography>
              </Stack>
            )}
            {/* The viewer's OWN book, separated from the overall number above. */}
            {myRow && (
              <Stack direction="row" alignItems="center" spacing={2} sx={{ flexWrap: { xs: "wrap", sm: "nowrap" }, rowGap: 0.5 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, whiteSpace: "nowrap", minWidth: 170, color: "text.secondary" }}>
                  {data.year} target (me)
                </Typography>
                <Box sx={{ flex: 1, minWidth: 120 }}>
                  {myRow.target ? (
                    <LinearProgress variant="determinate" value={Math.min(100, (myRow.revenueYtd / myRow.target) * 100)} sx={{ height: 10, borderRadius: 5 }} color={myRow.revenueYtd >= myRow.target ? "success" : "warning"} />
                  ) : (
                    <Typography variant="caption" sx={{ color: "text.disabled" }}>
                      no personal target set — User Management → Edit user → Yearly Sales Target
                    </Typography>
                  )}
                </Box>
                <Typography variant="body2" sx={{ fontWeight: 700, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", color: "text.secondary" }}>
                  {money(myRow.revenueYtd)}{myRow.target ? ` / ${money(myRow.target)}` : ""}
                </Typography>
              </Stack>
            )}
          </Stack>
        </Paper>
      )}

      {/* Master calendar across the visible projects */}
      <ScheduleOverview schedule={data.schedule || []} holidays={data.holidays || {}} holidaysMy={data.holidaysMy || {}} self={self} />
      {isAppointmentBookingEnabled && <AppointmentsCard self={self} />}
      {isDesignerAdvancesEnabled && <AdvancesCard self={self} />}

      {/* Management: per-designer table */}
      {!self && (
        <Paper variant="outlined" sx={{ borderRadius: 2, mb: 2.5, overflow: "hidden" }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, px: 2, pt: 1.5, pb: 0.5 }}>
            {data.scope === "team" ? "My team" : "Designers"}
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

      {/* Supplier rebates (management only — designers never get this data) */}
      {!self && rebates && rebates.totalRebate > 0 && (
        <Paper variant="outlined" sx={{ borderRadius: 2, mb: 2.5, overflow: "hidden" }} data-tour="dash-rebates">
          <Stack direction="row" alignItems="baseline" spacing={1} sx={{ px: 2, pt: 1.5, pb: 0.5 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              Supplier rebates
            </Typography>
            <Chip size="small" color="warning" variant="outlined" label="management only" sx={{ height: 20 }} />
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              costs stay at full value — this profit sits outside designer commissions · default {rebates.defaultPct}%
            </Typography>
          </Stack>
          <Grid container spacing={1.5} sx={{ px: 2, pb: 1.5 }}>
            <Grid item xs={12} md={4}>
              <Stack spacing={0.25}>
                <Typography variant="h5" sx={{ fontWeight: 800, color: "success.main", fontVariantNumeric: "tabular-nums" }}>{money(rebates.totalRebate)}</Typography>
                <Typography variant="caption" sx={{ color: "text.secondary" }}>
                  total rebate · {money(rebates.ongoingRebate)} on ongoing · {money(rebates.completedRebate)} on completed
                </Typography>
              </Stack>
            </Grid>
            <Grid item xs={12} md={4}>
              <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 700, display: "block", mb: 0.25 }}>Top projects</Typography>
              {rebates.byProject.slice(0, 4).map((p: any) => (
                <Stack key={p.projectId} direction="row" justifyContent="space-between" sx={{ cursor: "pointer" }} onClick={() => router.push(`/portal/projects/${p.projectId}`)}>
                  <Typography variant="caption" noWrap sx={{ maxWidth: 220 }}>{p.name}</Typography>
                  <Typography variant="caption" sx={{ fontVariantNumeric: "tabular-nums", color: "success.main" }}>{money(p.rebate)}</Typography>
                </Stack>
              ))}
            </Grid>
            <Grid item xs={12} md={4}>
              <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 700, display: "block", mb: 0.25 }}>Top contractors</Typography>
              {rebates.bySupplier.slice(0, 4).map((s: any) => (
                <Stack key={s.supplierName} direction="row" justifyContent="space-between">
                  <Typography variant="caption" noWrap sx={{ maxWidth: 220 }}>{s.supplierName}</Typography>
                  <Typography variant="caption" sx={{ fontVariantNumeric: "tabular-nums", color: "success.main" }}>{money(s.rebate)}</Typography>
                </Stack>
              ))}
            </Grid>
          </Grid>
        </Paper>
      )}

      {/* Open leads (mine for designers, org-wide for management) */}
      <Paper variant="outlined" sx={{ borderRadius: 2, mb: 2.5, overflow: "hidden" }}>
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
  {/* Project notes (Project.description) — data-review items for the owner. Sits LAST on the page (guru 2026-09-25). */}
      {(data.reviewNotes || []).length > 0 && (
        <Paper variant="outlined" sx={{ borderRadius: 2, mb: 2.5, overflow: "hidden" }} data-tour="dash-project-notes">
          <Stack direction="row" alignItems="baseline" spacing={1} sx={{ px: 2, pt: 1.5, pb: 0.5 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              Project notes
            </Typography>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              please review — click a project to open it
            </Typography>
          </Stack>
          <Stack divider={<Box sx={{ borderBottom: 1, borderColor: "divider" }} />}>
            {(data.reviewNotes || []).map((n) => (
              <Box key={n.projectId} sx={{ px: 2, py: 1.25, cursor: "pointer", "&:hover": { bgcolor: "action.hover" } }} onClick={() => router.push(`/portal/projects/${n.projectId}`)}>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                    {n.projectName}
                  </Typography>
                  {n.stage && <Chip size="small" variant="outlined" label={n.stage} sx={{ height: 20, textTransform: "capitalize" }} />}
                  <OpenInNewIcon sx={{ fontSize: 14, color: "text.disabled" }} />
                </Stack>
                <Typography variant="body2" sx={{ color: "text.secondary", whiteSpace: "pre-line" }}>
                  {n.note}
                </Typography>
              </Box>
            ))}
          </Stack>
        </Paper>
      )}

    </MainCard>
  );
}
