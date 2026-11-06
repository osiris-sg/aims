"use client";

// Round AY part 2 — the order page's "Overall process": every applicable step of the order and each shipment, in
// process order, with its state (done / now / upcoming / overdue), the date done or due, and each shipment's schedule
// (ETD, T/S, ETA, arrival, delivery dates) on top of its column. A due date comes from a rule on the schedule (it moves
// when ETD / ETA change) unless someone set it by hand on the step; click a date to change it or put it back.

import React, { useMemo, useState } from "react";
import { Box, Button, Chip, CircularProgress, Collapse, IconButton, Paper, Popover, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Tooltip, Typography } from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import EditCalendarIcon from "@mui/icons-material/EditCalendar";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useShipmentsApi, type ProcessCell } from "../_lib/api";
import { SHIPMENT_KEYS } from "../_lib/hooks";
import { cellView, scheduleParts, shortDay } from "../_lib/due";
import { toast } from "../_lib/toast";
import { useTranslations } from "next-intl";
import { useUiLang } from "@/i18n/UiLangProvider";
import { useStepName } from "@/i18n/hooks";
import { useUserPermissions } from "@/app/portal/hooks/useUserPermissions";

export const processKey = (orderId: string) => [...SHIPMENT_KEYS.orders, "process", orderId] as const;

export default function OverallProcess({ orderId, lang: langProp }: { orderId: string; lang?: "en" | "ja" }) {
  const uiLang = useUiLang().lang;
  const lang = langProp ?? uiLang;
  const t = useTranslations("shipments.overallProcess");
  const stepName = useStepName();
  const byHand = (w: string | null, at: string | null) => (at ? t("byHandOn", { who: w ?? t("hand"), date: shortDay(at.slice(0, 10)) }) : t("byHand", { who: w ?? t("hand") }));
  const api = useShipmentsApi();
  const qc = useQueryClient();
  const { hasPermission, userRoles } = useUserPermissions();
  const canEdit = hasPermission("shipments", "update") || userRoles.length === 0;
  const q = useQuery({ queryKey: processKey(orderId), queryFn: () => api.orderProcess(orderId) });
  const [open, setOpen] = useState(true);
  const [edit, setEdit] = useState<{ el: HTMLElement; cell: ProcessCell; value: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const d = q.data;
  const year = d?.today?.slice(0, 4);

  const save = async (value: string | null) => {
    if (!edit) return;
    setBusy(true);
    try {
      await api.setStepDue(edit.cell.stepId, value);
      await Promise.all([qc.invalidateQueries({ queryKey: processKey(orderId) }), qc.invalidateQueries({ queryKey: SHIPMENT_KEYS.orders })]);
      toast.success(value ? t("saved") : t("reset"));
      setEdit(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Round BG: the rule in the user's language, marked when it is the customer's own.
  const whyOf = (c: ProcessCell) => {
    const w = lang === "ja" && c.dueWhyJa ? c.dueWhyJa : c.dueWhy;
    return w ? `${w}${c.dueOrigin === "customer" ? ` (${t("ownRule")})` : ""}` : null;
  };
  const cell = (c: ProcessCell | undefined) => {
    if (!c) return <Typography variant="caption" color="text.disabled">{t("none")}</Typography>;
    const v = cellView(c, lang, year);
    // Without due dates (the org flag off) a not-done step shows only "Now" or nothing.
    if (!d?.dueDates && c.state !== "done" && !c.ongoing) v.sub = "";
    const editable = !!d?.dueDates && canEdit && c.state !== "done" && c.state !== "na";
    const tip = [c.flagged === false && c.due && c.state !== "done" ? t("before") : null, c.dueSource === "manual" ? byHand(c.dueSetByName, c.dueSetAt) : null, whyOf(c) ? `${t("ruleIs")}: ${whyOf(c)}` : null].filter(Boolean).join(" · ");
    return (
      <Stack spacing={0.25} alignItems="flex-start" data-state={c.state}>
        {v.head ? <Chip size="small" color={v.tone} variant={c.state === "upcoming" ? "outlined" : "filled"} label={v.head} sx={{ height: 20, "& .MuiChip-label": { px: 0.75, fontSize: 11, fontWeight: 700 } }} /> : null}
        <Tooltip title={tip} disableInteractive>
          <Box
            component={editable ? "button" : "span"}
            onClick={editable ? (e: React.MouseEvent<HTMLElement>) => setEdit({ el: e.currentTarget, cell: c, value: c.due ?? "" }) : undefined}
            sx={{ all: "unset", cursor: editable ? "pointer" : "default", fontSize: 12, color: c.state === "overdue" ? "error.main" : "text.secondary", display: "inline-flex", alignItems: "center", gap: 0.25, "&:hover": editable ? { textDecoration: "underline" } : undefined }}
            data-tour={editable ? "process-due" : undefined}
          >
            {v.sub}
            {c.dueSource === "manual" && c.state !== "done" ? <EditCalendarIcon sx={{ fontSize: 13 }} /> : null}
          </Box>
        </Tooltip>
      </Stack>
    );
  };

  const cols = useMemo(() => d?.columns ?? [], [d]);
  return (
    <Paper variant="outlined" sx={{ p: 1.5 }} data-tour="order-overall-process">
      <Stack direction="row" alignItems="center" spacing={1}>
        <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>{t("title")}</Typography>
        {d?.overdue ? <Chip size="small" color="error" label={t("overdue", { n: d.overdue })} sx={{ height: 20 }} /> : null}
        {d?.dueDates && d.dueSince ? <Typography variant="caption" color="text.secondary">{t("since", { date: shortDay(d.dueSince) })}</Typography> : null}
        <Box sx={{ flex: 1 }} />
        <IconButton size="small" onClick={() => setOpen((x) => !x)} aria-label={open ? t("collapse") : t("expand")}>
          {open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
        </IconButton>
      </Stack>
      <Collapse in={open}>
        {q.isLoading || !d ? (
          <CircularProgress size={20} sx={{ m: 1 }} />
        ) : (
          <TableContainer sx={{ mt: 1, maxWidth: "100%", overflowX: "auto" }}>
            <Table size="small" sx={{ "& td, & th": { verticalAlign: "top", py: 0.75 }, "& th, & th *": { textTransform: "none", letterSpacing: "normal" } }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ minWidth: 200, fontWeight: 700 }}>{t("step")}</TableCell>
                  {cols.map((c) => (
                    <TableCell key={c.id} sx={{ minWidth: 150 }}>
                      <Typography variant="body2" sx={{ fontWeight: 800 }}>{c.ref}{c.kind === "order" ? ` · ${t("order")}` : ""}</Typography>
                      {c.status !== "OPEN" && <Typography variant="caption" color="text.secondary">{c.status.toLowerCase()}</Typography>}
                      {c.schedule && (
                        <Stack spacing={0} data-tour="process-schedule">
                          {scheduleParts(c.schedule, lang, year).map((p) => (
                            <Typography key={p} variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>{p}</Typography>
                          ))}
                        </Stack>
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {d.rows.map((r) => (
                  <TableRow key={r.no || r.code}>
                    <TableCell>
                      <Typography variant="body2"><b>{r.no}</b> {stepName(r.code, lang === "ja" && r.titleJa ? r.titleJa : r.title)}</Typography>
                      {r.titleJa && <Typography variant="caption" color="text.secondary">{lang === "ja" ? r.title : r.titleJa}</Typography>}
                    </TableCell>
                    {cols.map((c) => (
                      <TableCell key={c.id}>{cell(r.cells[c.id])}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Collapse>
      <Popover open={!!edit} anchorEl={edit?.el ?? null} onClose={() => setEdit(null)} anchorOrigin={{ vertical: "bottom", horizontal: "left" }}>
        {edit && (
          <Box sx={{ p: 2, width: 280 }} data-tour="process-due-editor">
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{edit.cell.ref} · {edit.cell.no} {stepName(edit.cell.code, lang === "ja" && edit.cell.titleJa ? edit.cell.titleJa : edit.cell.title)}</Typography>
            {whyOf(edit.cell) && <Typography variant="caption" color="text.secondary" component="div">{t("ruleIs")}: {whyOf(edit.cell)}</Typography>}
            <TextField type="date" size="small" fullWidth label={t("set")} value={edit.value} onChange={(e) => setEdit({ ...edit, value: e.target.value })} InputLabelProps={{ shrink: true }} sx={{ mt: 1.5 }} />
            <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
              <Button variant="contained" size="small" disabled={busy || !/^\d{4}-\d{2}-\d{2}$/.test(edit.value)} onClick={() => save(edit.value)}>{t("save")}</Button>
              {edit.cell.dueSource === "manual" && <Button size="small" disabled={busy} onClick={() => save(null)}>{t("rule")}</Button>}
            </Stack>
          </Box>
        )}
      </Popover>
    </Paper>
  );
}
