"use client";

// Jobs calendar side panel, round 36 (WCT group, 2026-11-20, calendar style orgs): the customer as the title (plain
// text), the Subject and Remarks, every linked document with its own status (Order, Quotation, Invoices, DOs), the
// "Team / crew" field, quick toggles (PTW status, PTW applicant, Generate sticker, COD, Category; ✅ stays automatic),
// and Open job / Cancel job (Undo) / Postpone / Reschedule. All text can be selected and copied.
// Another company's job (group calendar) is read only here: a member opens it in one click (the tab switches to that
// company), a non member gets no link.

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Alert, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControlLabel, Radio, RadioGroup, Stack, TextField, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { toast } from "react-toastify";
import DateInput from "@/components/DateInput";
import { orderPageModel } from "@/helpers/orderPage";
import { applicantLabel, crewLine, timeWindow, type CalendarEvent } from "./calendarModel";
import {
  PTW_PILLS, applyToggle, canEditOnCalendar, colourCircle, crossOrgOpen, customerOf, panelDocsFallback, panelDocsFromOrder, ptwPillOf, ptwStatusOf, toggleRequest,
  type Clash, type PanelDoc, type PanelToggle, type RescheduleTarget,
} from "./calendarPanel";
import type { StylePerson } from "./calendarAddApi";

export interface CalendarCallResult {
  ok: boolean;
  data: any;
  message: string;
}

/** What the panel may do (absent = read only, e.g. the fixture preview without fake calls). */
export interface CalendarActions {
  call: (method: string, path: string, body?: any, orgId?: string | null) => Promise<CalendarCallResult>;
  reload: () => void;
  applicants: StylePerson[];
  defaultApplicant: StylePerson | null;
  /** The org's job categories (null: the org has none). */
  categories: string[] | null;
}

const STATUS_HUE: Record<string, string> = {
  paid: "#2e7d32", completed: "#2e7d32", accepted: "#2e7d32", done: "#2e7d32", complete: "#2e7d32",
  overdue: "#c62828", cancelled: "#757575", voided: "#757575", void: "#757575", declined: "#757575", expired: "#757575", credited: "#757575",
  draft: "#757575", pending: "#ef6c00", sent: "#1565c0", invoiced: "#1565c0",
};
const hueOf = (status: string) => {
  const s = status.toLowerCase();
  const key = Object.keys(STATUS_HUE).find((k) => s.startsWith(k));
  return key ? STATUS_HUE[key] : "#546e7a";
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Stack direction="row" spacing={1} sx={{ mb: 0.75 }}>
      <Typography variant="body2" color="text.secondary" sx={{ minWidth: 92, flexShrink: 0 }}>
        {label}
      </Typography>
      <Typography variant="body2" component="div" sx={{ wordBreak: "break-word", minWidth: 0, flex: 1 }}>
        {children}
      </Typography>
    </Stack>
  );
}

function Pill({ label, on, disabled, onClick }: { label: string; on: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <Chip
      size="small"
      label={label}
      clickable={!disabled}
      disabled={disabled}
      onClick={onClick}
      color={on ? "primary" : "default"}
      variant={on ? "filled" : "outlined"}
      sx={{ fontWeight: on ? 600 : 400 }}
    />
  );
}

function StatusChip({ status }: { status: string }) {
  if (!status) return null;
  const c = hueOf(status);
  return <Chip size="small" label={status} sx={{ height: 20, fontSize: "0.7rem", bgcolor: alpha(c, 0.12), color: "text.primary", border: `1px solid ${alpha(c, 0.45)}` }} />;
}

/** Another company's link: one click switches this tab to that company and opens the job there. */
function DocLink({ doc, onCross }: { doc: PanelDoc; onCross?: (href: string) => void }) {
  const num = <Box component="span" sx={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{doc.number}</Box>;
  if (!doc.href) return num;
  if (onCross)
    return (
      <a href={doc.href} style={{ color: "inherit" }} onClick={(ev) => { ev.preventDefault(); onCross(doc.href!); }}>
        {num}
      </a>
    );
  return (
    <Link href={doc.href} style={{ color: "inherit" }}>
      {num}
    </Link>
  );
}

const fmtDay = (date: string) => new Intl.DateTimeFormat("en-SG", { weekday: "short", day: "numeric", month: "short" }).format(new Date(`${date}T12:00:00+08:00`));
const fmtTime = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
};

export default function StyledJobPanel({
  event: e,
  actions,
  onPatched,
  onReschedulePreview,
  clashes,
  onCrossOpen,
}: {
  event: CalendarEvent;
  actions?: CalendarActions;
  /** The event as it reads now (shown at once, before the calendar reloads). */
  onPatched: (e: CalendarEvent) => void;
  /** Postpone / Reschedule: the picked day (the calendar jumps there and marks clashes), null when closed. */
  onReschedulePreview: (t: RescheduleTarget | null) => void;
  clashes: Clash[];
  onCrossOpen: (orgId: string, href: string) => void;
}) {
  const editable = !!actions && canEditOnCalendar(e);
  const cross = crossOrgOpen(e);
  const openCross = cross ? (href: string) => onCrossOpen(cross.orgId, href) : undefined;
  const customer = customerOf(e);
  const remarks = e.remarks && e.remarks.trim().toLowerCase() !== (e.subject ?? "").trim().toLowerCase() ? e.remarks : null;

  // Linked documents: the order page's own list (status chips as the order page shows them), else the job's own.
  const [docs, setDocs] = useState<PanelDoc[] | null>(null);
  const orderId = e.orderHref ? e.orderHref.split("/").filter(Boolean).pop() ?? null : null;
  useEffect(() => {
    let live = true;
    const fallback = [...(e.orderNumber && !orderId ? [{ key: "order", label: "Order" as const, number: e.orderNumber, status: "", href: null }] : []), ...panelDocsFallback(e)];
    setDocs(orderId && actions ? null : fallback);
    if (!orderId || !actions) return;
    void actions.call("GET", `/orders/${orderId}`, undefined, e.foreign ? e.orgId ?? null : null).then((res) => {
      if (!live) return;
      if (!res.ok || !res.data) return setDocs([{ key: "order", label: "Order", number: e.orderNumber || "", status: "", href: e.orderHref ?? null }, ...panelDocsFallback(e).filter((d) => d.key !== "order")]);
      try {
        setDocs(panelDocsFromOrder(orderPageModel(res.data, {}), e.orderHref ?? null));
      } catch {
        setDocs(fallback);
      }
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e.id, orderId, !!actions]);

  // Team / crew: typed here, saved when the field is left (or Enter).
  const [team, setTeam] = useState(e.team ?? "");
  useEffect(() => setTeam(e.team ?? ""), [e.id, e.team]);

  const [busy, setBusy] = useState(false);
  const toggle = async (t: PanelToggle) => {
    if (!actions || !editable) return;
    const req = toggleRequest(e, t, ptwStatusOf(e));
    if (!req) return;
    const before = e;
    onPatched(applyToggle(e, t, actions.defaultApplicant));
    const res = await actions.call(req.method, req.path, req.body);
    if (!res.ok) {
      onPatched(before);
      toast.error(res.message || "Couldn't save");
      return;
    }
    actions.reload();
  };
  const saveTeam = () => {
    const next = team.replace(/\s+/g, " ").trim();
    if (next === (e.team ?? "")) return;
    void toggle({ kind: "team", team: next || null });
  };

  // Cancel job (confirm) and its Undo.
  const [askCancel, setAskCancel] = useState(false);
  const cancelJob = async () => {
    if (!actions) return;
    setBusy(true);
    const before = e;
    onPatched({ ...e, cancelled: true, calendarCancelled: true, statusLabel: "Cancelled", style: e.style ? { ...e.style, greyed: true } : e.style });
    const res = await actions.call("POST", `/deliveries/${e.id.slice(5)}/calendar-cancel`);
    setBusy(false);
    setAskCancel(false);
    if (!res.ok) {
      onPatched(before);
      return void toast.error(res.message || "Couldn't cancel the job");
    }
    toast.success(`${customer} cancelled`);
    actions.reload();
  };
  const undoCancel = async () => {
    if (!actions) return;
    setBusy(true);
    const before = e;
    onPatched({ ...e, cancelled: false, calendarCancelled: false, statusLabel: "Scheduled", style: e.style ? { ...e.style, greyed: !!e.postponed } : e.style });
    const res = await actions.call("POST", `/deliveries/${e.id.slice(5)}/calendar-uncancel`);
    setBusy(false);
    if (!res.ok) {
      onPatched(before);
      return void toast.error(res.message || "Couldn't undo");
    }
    toast.success(`${customer} is back on the calendar`);
    actions.reload();
  };

  // Postpone / Reschedule: inline, so the calendar behind the panel shows the new day and its clashes.
  const [resched, setResched] = useState<{ mode: "date" | "hold"; date: string; time: string; allDay: boolean } | null>(null);
  const [askResched, setAskResched] = useState(false);
  const target: RescheduleTarget | null = resched?.mode === "date" && /^\d{4}-\d{2}-\d{2}$/.test(resched.date) ? { date: resched.date, time: resched.allDay || !resched.time ? null : resched.time } : null;
  useEffect(() => {
    onReschedulePreview(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.date, target?.time]);
  useEffect(() => () => onReschedulePreview(null), [onReschedulePreview]);
  useEffect(() => {
    setResched(null);
    setAskCancel(false);
    setAskResched(false);
  }, [e.id]);
  const openResched = () => {
    const d = e.allDay ? e.start.slice(0, 10) : new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(e.start));
    const t = e.allDay ? "" : new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Singapore", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(e.start));
    setResched({ mode: "date", date: d, time: t, allDay: e.allDay });
  };
  const saveResched = async () => {
    if (!actions || !resched) return;
    setBusy(true);
    const body = resched.mode === "hold" ? { onHold: true } : { date: target!.date, time: target!.time };
    const before = e;
    if (resched.mode === "hold") onPatched({ ...e, postponed: true, statusLabel: "Postponed", style: e.style ? { ...e.style, greyed: true } : e.style });
    const res = await actions.call("POST", `/deliveries/${e.id.slice(5)}/reschedule`, body);
    setBusy(false);
    setAskResched(false);
    if (!res.ok) {
      onPatched(before);
      return void toast.error(res.message || "Couldn't save");
    }
    toast.success(resched.mode === "hold" ? `${customer} is on hold` : `${customer} moved to ${fmtDay(target!.date)}${target!.time ? `, ${fmtTime(target!.time)}` : ""}`);
    setResched(null);
    onReschedulePreview(null);
    actions.reload();
  };

  const people = useMemo(() => actions?.applicants ?? [], [actions]);
  const ptw = ptwStatusOf(e);
  const ptwNeeded = ptw !== "NOT_NEEDED";
  const canResched = editable && !e.cancelled && e.status === "scheduled";
  const canCancel = editable && !e.cancelled && e.status === "scheduled";

  return (
    <Box sx={{ userSelect: "text", "& *": { userSelect: "text" } }} data-tour="jobs-calendar-panel-card">
      {e.orgName && (
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.25 }}>
          {e.orgName}
        </Typography>
      )}
      <Typography variant="h6" component="div" sx={{ fontWeight: 600, lineHeight: 1.3, textDecoration: e.cancelled ? "line-through" : "none", wordBreak: "break-word" }}>
        {customer}
      </Typography>
      {e.subject && (
        <Typography variant="body2" sx={{ mt: 0.5, wordBreak: "break-word" }}>
          {e.subject}
        </Typography>
      )}
      {remarks && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {remarks}
        </Typography>
      )}
      {(e.cancelled || e.postponed) && (
        <Stack direction="row" spacing={0.75} sx={{ mt: 1 }}>
          {e.cancelled ? <Chip size="small" label="❌ Cancelled" /> : <Chip size="small" label="⭕ On hold" />}
        </Stack>
      )}
      <Divider sx={{ my: 1.5 }} />
      <Row label="When">{timeWindow(e)}</Row>
      {e.address && <Row label="Address">{e.address}</Row>}
      <Row label="Team / crew">
        {editable ? (
          <TextField
            size="small"
            fullWidth
            value={team}
            onChange={(ev) => setTeam(ev.target.value)}
            onBlur={saveTeam}
            onKeyDown={(ev) => {
              if (ev.key === "Enter") (ev.target as HTMLInputElement).blur();
            }}
            inputProps={{ maxLength: 120, "aria-label": "Team / crew", "data-tour": "jobs-calendar-team" }}
            sx={{ "& .MuiInputBase-input": { py: 0.5 } }}
          />
        ) : (
          e.team || "-"
        )}
      </Row>
      {e.salesperson?.name && <Row label="Salesperson">{e.salesperson.name}</Row>}
      {!editable && ptwNeeded && e.ptwApplicant && <Row label="PTW applicant">{applicantLabel(e.ptwApplicant)}</Row>}
      {/* Created by: hidden while still unknown. */}
      {!e.foreign && e.createdBy?.name && <Row label="Created by">{e.createdBy.name}</Row>}
      {e.crew.length > 0 && (
        <Row label="Crew">
          {e.crew.map((c) => (
            <div key={c.name}>{crewLine(c)}</div>
          ))}
        </Row>
      )}
      {docs === null ? (
        <Typography variant="body2" color="text.secondary" sx={{ my: 1 }}>
          Loading documents
        </Typography>
      ) : (
        docs.map((d) => (
          <Row key={d.key} label={d.label}>
            <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
              <DocLink doc={d} onCross={openCross} />
              <StatusChip status={d.status} />
            </Stack>
          </Row>
        ))
      )}

      {editable && (
        <>
          <Divider sx={{ my: 1.5 }} />
          <Stack spacing={1.25} data-tour="jobs-calendar-toggles">
            <Box>
              <Typography variant="caption" color="text.secondary">
                PTW
              </Typography>
              <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
                {PTW_PILLS.map((p) => (
                  <Pill key={p.value} label={p.label} on={ptwPillOf(ptw) === p.value} onClick={() => void toggle({ kind: "ptw", status: p.value })} />
                ))}
              </Stack>
            </Box>
            {ptwNeeded && people.length > 0 && (
              <Box>
                <Typography variant="caption" color="text.secondary">
                  PTW applicant
                </Typography>
                <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
                  {people.map((p) => (
                    <Pill
                      key={p.id}
                      label={`${p.name}${colourCircle(p.colour) ? ` ${colourCircle(p.colour)}` : ""}`}
                      on={e.ptwApplicant?.id === p.id}
                      onClick={() => void toggle({ kind: "applicant", applicant: e.ptwApplicant?.id === p.id ? null : { id: p.id, name: p.name, colour: p.colour } })}
                    />
                  ))}
                </Stack>
              </Box>
            )}
            <Box>
              <Typography variant="caption" color="text.secondary">
                Marks
              </Typography>
              <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
                <Pill label="📌 Generate sticker" on={!!e.sticker} onClick={() => void toggle({ kind: "sticker", on: !e.sticker })} />
                <Pill label="🟫 COD" on={!!e.cod} onClick={() => void toggle({ kind: "cod", on: !e.cod })} />
              </Stack>
            </Box>
            {actions?.categories && actions.categories.length > 0 && (
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Category
                </Typography>
                <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
                  {actions.categories.map((c) => (
                    <Pill key={c} label={c} on={(e.category ?? "").toLowerCase() === c.toLowerCase()} onClick={() => void toggle({ kind: "category", category: c })} />
                  ))}
                </Stack>
              </Box>
            )}
          </Stack>
        </>
      )}

      {resched && (
        <Box sx={{ mt: 2, p: 1.5, border: 1, borderColor: "divider", borderRadius: 1 }} data-tour="jobs-calendar-reschedule">
          <RadioGroup value={resched.mode} onChange={(ev) => setResched({ ...resched, mode: ev.target.value as "date" | "hold" })}>
            <FormControlLabel value="date" control={<Radio size="small" />} label="New date / time" />
            {resched.mode === "date" && (
              <Stack direction="row" spacing={1} alignItems="center" sx={{ pl: 3.5, mb: 1 }}>
                <DateInput label="Date" size="small" value={resched.date} onChange={(ev) => setResched({ ...resched, date: ev.target.value })} InputLabelProps={{ shrink: true }} sx={{ flex: 1 }} />
                <TextField
                  label="Time"
                  type="time"
                  size="small"
                  value={resched.allDay ? "" : resched.time}
                  disabled={resched.allDay}
                  onChange={(ev) => setResched({ ...resched, time: ev.target.value })}
                  InputLabelProps={{ shrink: true }}
                  sx={{ width: 120 }}
                />
                <FormControlLabel
                  control={<Checkbox size="small" checked={resched.allDay} onChange={(ev) => setResched({ ...resched, allDay: ev.target.checked })} />}
                  label="All day"
                  sx={{ mr: 0 }}
                />
              </Stack>
            )}
            <FormControlLabel value="hold" control={<Radio size="small" />} label="On hold, no date ⭕" />
          </RadioGroup>
          {resched.mode === "date" && clashes.length > 0 && (
            <Alert severity="warning" sx={{ mt: 1 }}>
              {clashes.map((c) => (
                <div key={c.event.id}>{`${customerOf(c.event)}: ${c.reasons.join(", ").toLowerCase()}`}</div>
              ))}
            </Alert>
          )}
          <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 1.5 }}>
            <Button size="small" onClick={() => setResched(null)}>
              Back
            </Button>
            <Button size="small" variant="contained" disableElevation disabled={busy || (resched.mode === "date" && !target)} onClick={() => setAskResched(true)}>
              Save
            </Button>
          </Stack>
        </Box>
      )}

      <Divider sx={{ my: 1.5 }} />
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        {e.href && !e.foreign && (
          <Button component={Link} href={e.href} size="small" variant="contained" disableElevation>
            Open job
          </Button>
        )}
        {cross && (
          <Button size="small" variant="contained" disableElevation onClick={() => onCrossOpen(cross.orgId, cross.href)}>
            {`Open job in ${e.orgName || "its company"}`}
          </Button>
        )}
        {editable && e.cancelled && e.calendarCancelled && (
          <Button size="small" variant="outlined" disabled={busy} onClick={() => void undoCancel()}>
            Undo cancel
          </Button>
        )}
        {canCancel && (
          <Button size="small" variant="outlined" color="error" disabled={busy} onClick={() => setAskCancel(true)}>
            Cancel job
          </Button>
        )}
        {canResched && !resched && (
          <Button size="small" variant="outlined" disabled={busy} onClick={openResched}>
            Postpone / Reschedule
          </Button>
        )}
      </Stack>

      <Dialog open={askCancel} onClose={() => setAskCancel(false)}>
        <DialogTitle>{`Cancel the job for ${customer}?`}</DialogTitle>
        <DialogContent>
          <Typography variant="body2">{timeWindow(e)}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAskCancel(false)}>Keep</Button>
          <Button color="error" variant="contained" disableElevation disabled={busy} onClick={() => void cancelJob()}>
            Cancel job
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={askResched} onClose={() => setAskResched(false)}>
        <DialogTitle>
          {resched?.mode === "hold" ? `Put ${customer} on hold?` : target ? `Move ${customer} to ${fmtDay(target.date)}${target.time ? `, ${fmtTime(target.time)}` : ""}?` : ""}
        </DialogTitle>
        {resched?.mode === "date" && clashes.length > 0 && (
          <DialogContent>
            <Alert severity="warning">
              <div>{clashes.length === 1 ? "1 job clashes:" : `${clashes.length} jobs clash:`}</div>
              {clashes.map((c) => (
                <div key={c.event.id}>{`${customerOf(c.event)}: ${c.reasons.join(", ").toLowerCase()}`}</div>
              ))}
            </Alert>
          </DialogContent>
        )}
        <DialogActions>
          <Button onClick={() => setAskResched(false)}>Back</Button>
          <Button variant="contained" disableElevation disabled={busy} onClick={() => void saveResched()}>
            {resched?.mode === "date" && clashes.length > 0 ? "Save anyway" : "Save"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
