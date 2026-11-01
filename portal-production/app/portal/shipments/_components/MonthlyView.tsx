/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Round AM (ADH) — the Monthly view of Orders (was Sales › Monthly list, round AG): ADH's own spreadsheet as a table.
// One block per client (Kato, SUS, Hoei, then the others), one row per shipment (an order with no shipment yet = one
// row; an order with 3 B/Ls = 3 rows whose order / supplier cells are shown once, merged). Three column groups — Order
// information · Supplier information · Shipment information. The two yellow Status columns are plain words computed
// from the steps (Order Status: Waiting for shipment … Completed; Supplier Status: PI received … Done), one per row;
// Notes is the shipment's own note (click to edit). 管理NO is ADH's client-order number (#n-s). Month picker: this
// month by default, ‹ › to step, "Range" for From / To. Export: .xlsx in their layout, CSV. A row opens the order on
// that shipment's current step. Used on the Orders page (view=monthly) and on a client's Orders tab (pre-filtered).
// Round AN: it renders under the Orders page's shared header (OrdersListView) — no heading of its own; one toolbar row
// (Month ‹ ›, Range, Month by, Client, Supplier, Grade, Order Status, the totals, Export). The header's tab (Pending /
// Completed / All), Search and main Filter (contract, customer, ship month) apply here too; a search that matches only in
// other months says which (one click jumps there).

import { useUiLang } from "@/i18n/UiLangProvider";
import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Box, Button, Chip, CircularProgress, FormControlLabel, IconButton, Menu, MenuItem, Paper, Popover, Stack, Switch, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Tooltip, Typography } from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useShipmentsApi, type MonthlyQuery, type MonthlyRow } from "../_lib/api";
import { orderHref } from "../_lib/inbox-threads";
import { toast } from "../_lib/toast";
import { fmtMonth } from "../_lib/format";
import { currentLang } from "@/i18n/lang";

const YELLOW = { bgcolor: "rgba(255, 214, 0, 0.18)" };
const GROUPS = [
  { key: "order", cols: 9, tour: "monthly-group-order" },
  { key: "supplier", cols: 4, tour: "monthly-group-supplier" },
  { key: "shipment", cols: 5, tour: "monthly-group-shipment" },
];
// ADH's own spreadsheet headings (catalog orders.monthly.headers.0–17).
const HEADERS = Array.from({ length: 18 }, (_, i) => String(i));
const YELLOW_COLS = new Set([8, 12]);
const month = (ym: string | null) => (ym && /^\d{4}-\d{2}$/.test(ym) ? fmtMonth(ym) : (ym ?? ""));
// ADH's sheet writes DD/MM/YYYY; in Japanese YYYY/MM/DD.
const dmy = (d: string | null) => (d ? (currentLang() === "ja" ? `${d.slice(0, 4)}/${d.slice(5, 7)}/${d.slice(8, 10)}` : `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`) : "");
const t3 = (n: number | null) => (n === null || n === undefined ? "" : Number(n).toLocaleString("en-US", { maximumFractionDigits: 3 }));
export const addMonth = (ym: string, n: number) => {
  const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5)) - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
export const tokyoMonth = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);


function download(fileName: string, contentType: string, base64: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: contentType }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

type MainFilters = { contractId?: string; customerId?: string; shipMonth?: string };
type Counts = { pending: number; completed: number; all: number };

export default function MonthlyView({
  customerId,
  supplierId,
  bucket = "all",
  search,
  mainFilters,
  onClientChange,
  onCounts,
}: {
  customerId?: string;
  supplierId?: string;
  /** Round AN — the shared header's tab, Search and main Filter. */
  bucket?: "pending" | "completed" | "all";
  search?: string;
  mainFilters?: MainFilters;
  /** The Client select is the main Filter's Customer (one state) when given. */
  onClientChange?: (customerId: string) => void;
  onCounts?: (c: Counts | null) => void;
}) {
  const api = useShipmentsApi();
  const router = useRouter();
  const qc = useQueryClient();
  const now = tokyoMonth();
  const { lang } = useUiLang();
  const t = useTranslations("orders.monthly");
  const [range, setRange] = useState(false);
  const [q, setQ] = useState<MonthlyQuery>({ from: now, to: now, basis: "delivery" });
  const clientId = customerId || (onClientChange ? mainFilters?.customerId : q.customerId) || undefined;
  const query: MonthlyQuery = {
    ...q,
    to: range ? q.to : q.from,
    customerId: clientId,
    ...(supplierId ? { supplierId } : {}),
    ...(bucket !== "all" ? { bucket } : {}),
    ...(search?.trim() ? { q: search.trim() } : {}),
    ...(mainFilters?.contractId ? { contractId: mainFilters.contractId } : {}),
    ...(mainFilters?.shipMonth ? { shipMonth: mainFilters.shipMonth } : {}),
  };
  if (!query.customerId) delete query.customerId;
  const list = useQuery({ queryKey: ["trade-monthly-list", query], queryFn: () => api.monthlyList(query), staleTime: 30_000, placeholderData: (prev) => prev });
  useEffect(() => {
    onCounts?.(list.data?.counts ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.data?.counts?.pending, list.data?.counts?.completed, list.data?.counts?.all]);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ pos: { left: number; top: number }; row: MonthlyRow; text: string } | null>(null);
  const data = list.data;
  const set = (k: keyof MonthlyQuery, v: string) => setQ((p) => ({ ...p, [k]: v || undefined }));
  const step = (n: number) => setQ((p) => ({ ...p, from: addMonth(p.from ?? now, n), to: addMonth((range ? p.to : p.from) ?? now, n) }));
  const exportAs = async (format: "xlsx" | "csv") => {
    setMenu(null);
    setBusy(true);
    try {
      const f = await api.monthlyExport(query, format);
      download(f.fileName, f.contentType, f.base64);
    } catch (e: any) {
      toast.error(e?.message || t("exportFailed"));
    } finally {
      setBusy(false);
    }
  };
  const open = (r: MonthlyRow) => {
    const href = orderHref(r.orderId, r.shipmentId, r.stepId);
    if (href) router.push(href);
  };
  const saveNote = async () => {
    if (!note?.row.shipmentId) return;
    try {
      await api.updateShipment(note.row.shipmentId, { notes: note.text.trim() || null });
      setNote(null);
      await qc.invalidateQueries({ queryKey: ["trade-monthly-list"] });
      toast.success(t("noteSaved"));
    } catch (e: any) {
      toast.error(e?.message || t("noteError"));
    }
  };
  const stageLabel = (r: MonthlyRow) => {
    const ja = data?.options.stages?.find((s) => s.code === r.orderStage)?.ja;
    return lang === "ja" && ja ? ja : r.orderStageLabel;
  };
  // Supplier status words in Japanese (the API sends the English label + the code).
  const supplierLabel = (r: MonthlyRow) => (lang === "ja" && t.has(`supplierStage.${r.supplierStage}`) ? t(`supplierStage.${r.supplierStage}`) : r.supplierStageLabel);

  const cells = useMemo(
    () => (r: MonthlyRow) => {
      const o = r.first;
      const span = o ? r.span : 0;
      // The order / supplier cells sit on the order's first row, spanning its shipment rows (the merged look);
      // the two Status columns are each row's own.
      const merged = (i: number, v: React.ReactNode, sx: object = {}) =>
        o ? (
          <TableCell key={i} rowSpan={span} sx={{ verticalAlign: "top", ...sx }}>
            {v}
          </TableCell>
        ) : null;
      return [
        merged(0, <b>{r.client}</b>),
        merged(1, r.orderNo, { fontWeight: 700, whiteSpace: "nowrap" }),
        merged(2, dmy(r.orderDate), { whiteSpace: "nowrap" }),
        merged(3, r.billetType),
        merged(4, r.supplier),
        merged(5, t3(r.ton), { textAlign: "right", fontVariantNumeric: "tabular-nums" }),
        merged(6, month(r.shipMonth), { whiteSpace: "nowrap" }),
        merged(7, month(r.deliveryMonth), { whiteSpace: "nowrap" }),
        <TableCell key={8} sx={{ ...YELLOW, fontWeight: 600 }} data-tour="monthly-order-status">
          <Tooltip title={r.shipmentStatus ? t("currentStep", { step: r.shipmentStatus }) : ""} disableInteractive>
            <span>
              {stageLabel(r)}
              {r.unconfirmed && (
                <Typography component="span" variant="caption" color="warning.main" sx={{ ml: 0.5 }}>
                  {t("check")}
                </Typography>
              )}
            </span>
          </Tooltip>
          {r.overdue && (
            // Round AY: steps past their due date on this row.
            <Tooltip title={r.overdue.labels.join("\n")} disableInteractive slotProps={{ tooltip: { sx: { whiteSpace: "pre-line" } } }}>
              <Chip size="small" color="error" variant="outlined" label={t("overdueDays", { n: r.overdue.days })} sx={{ ml: 0.75, height: 20, "& .MuiChip-label": { px: 0.75, fontSize: 11 } }} data-tour="monthly-overdue" />
            </Tooltip>
          )}
        </TableCell>,
        merged(9, r.supplierContractNo ?? "", { whiteSpace: "pre-line" }), // round AM: a split order lists "contract · PI" per supplier order
        merged(10, dmy(r.supplierOrderDate), { whiteSpace: "nowrap" }),
        merged(11, t3(r.supplierTon), { textAlign: "right", fontVariantNumeric: "tabular-nums" }),
        <TableCell key={12} sx={{ ...YELLOW, fontWeight: 600 }} data-tour="monthly-supplier-status">
          {supplierLabel(r)}
        </TableCell>,
        <TableCell key={13} sx={{ fontWeight: 700, whiteSpace: "nowrap" }} data-tour="monthly-kanri">
          {r.managementNo}
        </TableCell>,
        <TableCell key={14} sx={{ whiteSpace: "nowrap" }}>
          {r.blNumber ?? ""}
        </TableCell>,
        <TableCell key={15} sx={{ whiteSpace: "nowrap" }}>
          {dmy(r.etd)}
        </TableCell>,
        <TableCell key={16} sx={{ whiteSpace: "nowrap" }}>
          {dmy(r.eta)}
        </TableCell>,
        <TableCell
          key={17}
          sx={{ minWidth: 160, maxWidth: 260, whiteSpace: "pre-line", color: r.notes ? "text.primary" : "text.disabled", cursor: r.shipmentId ? "text" : "default" }}
          data-tour="monthly-notes"
          onClick={(e) => {
            e.stopPropagation();
            if (r.shipmentId) setNote({ pos: { left: e.clientX, top: e.clientY }, row: r, text: r.notes ?? "" });
          }}
        >
          {r.notes ?? (r.shipmentId ? t("addNote") : "")}
        </TableCell>,
      ];
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lang, t, data?.options.stages]
  );

  return (
    <Box sx={{ width: "100%", maxWidth: "100%", minWidth: 0, boxSizing: "border-box", display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }} data-tour="monthly-list">
      <Paper variant="outlined" sx={{ px: 1.5, py: 1, mb: 1.5 }} data-tour="monthly-filters">
        <Stack direction="row" alignItems="center" spacing={1.25} flexWrap="wrap" useFlexGap>
          <Stack direction="row" alignItems="center" spacing={0.5} data-tour="monthly-month-picker">
            <IconButton size="small" onClick={() => step(-1)} aria-label={t("prevMonth")}>
              <ChevronLeftIcon />
            </IconButton>
            <TextField type="month" size="small" label={range ? t("from") : t("month")} value={q.from ?? ""} onChange={(e) => set("from", e.target.value)} InputLabelProps={{ shrink: true }} sx={{ width: 160 }} />
            {range && <TextField type="month" size="small" label={t("to")} value={q.to ?? ""} onChange={(e) => set("to", e.target.value)} InputLabelProps={{ shrink: true }} sx={{ width: 160 }} />}
            <IconButton size="small" onClick={() => step(1)} aria-label={t("nextMonth")}>
              <ChevronRightIcon />
            </IconButton>
            <FormControlLabel
              sx={{ ml: 0.25, mr: 0 }}
              control={
                <Switch
                  size="small"
                  checked={range}
                  onChange={(e) => {
                    setRange(e.target.checked);
                    if (e.target.checked) setQ((p) => ({ ...p, to: addMonth(p.from ?? now, 2) }));
                  }}
                />
              }
              label={t("range")}
            />
            {q.from !== now && (
              <Button size="small" onClick={() => setQ((p) => ({ ...p, from: now, to: range ? addMonth(now, 2) : now }))} sx={{ textTransform: "none" }}>
                {t("thisMonth")}
              </Button>
            )}
          </Stack>
          <TextField select size="small" label={t("monthBy")} value={q.basis ?? "delivery"} onChange={(e) => set("basis", e.target.value)} sx={{ minWidth: 140 }}>
            <MenuItem value="delivery">{t("deliveryMonth")}</MenuItem>
            <MenuItem value="ship">{t("shipmentMonth")}</MenuItem>
          </TextField>
          {!customerId && (
            <TextField select size="small" label={t("client")} value={clientId ?? ""} onChange={(e) => (onClientChange ? onClientChange(e.target.value) : set("customerId", e.target.value))} sx={{ minWidth: 120 }}>
              <MenuItem value="">{t("all")}</MenuItem>
              {(data?.options.clients ?? []).map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.name}
                </MenuItem>
              ))}
            </TextField>
          )}
          {!supplierId && (
            <TextField select size="small" label={t("supplier")} value={q.supplier ?? ""} onChange={(e) => set("supplier", e.target.value)} sx={{ minWidth: 120 }}>
              <MenuItem value="">{t("all")}</MenuItem>
              {(data?.options.suppliers ?? []).map((s) => (
                <MenuItem key={s} value={s}>
                  {s}
                </MenuItem>
              ))}
            </TextField>
          )}
          <TextField select size="small" label={t("grade")} value={q.grade ?? ""} onChange={(e) => set("grade", e.target.value)} sx={{ minWidth: 100 }}>
            <MenuItem value="">{t("all")}</MenuItem>
            {(data?.options.grades ?? []).map((g) => (
              <MenuItem key={g} value={g}>
                {g}
              </MenuItem>
            ))}
          </TextField>
          <TextField select size="small" label={t("orderStatus")} value={q.stage ?? ""} onChange={(e) => set("stage", e.target.value)} sx={{ minWidth: 170 }}>
            <MenuItem value="">{t("all")}</MenuItem>
            {(data?.options.stages ?? []).map((s) => (
              <MenuItem key={s.code} value={s.code}>
                {lang === "ja" ? s.ja : s.en}
              </MenuItem>
            ))}
          </TextField>
          <Stack direction="row" alignItems="center" spacing={1.25} sx={{ ml: "auto" }}>
            {data && (
              <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "nowrap" }} data-tour="monthly-totals">
                {t("totals", { orders: data.totals.orders, rows: data.totals.rows, tons: t3(data.totals.tons) })}
              </Typography>
            )}
            <Button variant="contained" startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <DownloadIcon />} disabled={busy || !data?.totals.rows} onClick={(e) => setMenu(e.currentTarget)} sx={{ textTransform: "none" }} data-tour="monthly-export">
              {t("export")}
            </Button>
            <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)}>
              <MenuItem onClick={() => void exportAs("xlsx")}>{t("exportXlsx")}</MenuItem>
              <MenuItem onClick={() => void exportAs("csv")}>{t("exportCsv")}</MenuItem>
            </Menu>
          </Stack>
        </Stack>
      </Paper>
      {list.isError && <Alert severity="error">{(list.error as Error)?.message || t("loadError")}</Alert>}
      {list.isLoading ? (
        <CircularProgress />
      ) : !data?.blocks.length ? (
        <Paper variant="outlined" sx={{ p: 3, textAlign: "center" }}>
          <Typography color="text.secondary">
            {t(`empty.${bucket}`, { q: query.q ?? "", hasQ: query.q ? "yes" : "no", when: range ? t("thisRange") : month(q.from ?? now) })}
          </Typography>
          {!!data?.elsewhere?.length && (
            <Stack direction="row" spacing={1} justifyContent="center" alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }} data-tour="monthly-elsewhere">
              <Typography variant="body2" color="text.secondary">
                {t("foundIn")}
              </Typography>
              {data.elsewhere.slice(0, 8).map((m) => (
                <Chip
                  key={m}
                  size="small"
                  color="primary"
                  variant="outlined"
                  label={month(m)}
                  onClick={() => {
                    setRange(false);
                    setQ((p) => ({ ...p, from: m, to: m }));
                  }}
                />
              ))}
            </Stack>
          )}
          {bucket !== "all" && !data?.elsewhere?.length && !!data?.counts?.all && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {t("inAllTab", { n: data.counts.all })}
            </Typography>
          )}
        </Paper>
      ) : (
        <TableContainer component={Paper} variant="outlined" sx={{ maxWidth: "100%", overflow: "auto", maxHeight: "calc(100vh - 330px)" }}>
          <Table size="small" stickyHeader sx={{ "& td, & th": { borderRight: "1px solid", borderColor: "divider", px: 0.75, py: 0.5, fontSize: 12.5, verticalAlign: "top" } }}>
            <TableHead>
              <TableRow>
                {GROUPS.map((g) => (
                  <TableCell key={g.key} colSpan={g.cols} align="center" sx={{ fontWeight: 800, bgcolor: "background.paper" }} data-tour={g.tour}>
                    {t(`groups.${g.key}`)}
                  </TableCell>
                ))}
              </TableRow>
              <TableRow>
                {HEADERS.map((h, i) => (
                  <TableCell key={i} sx={{ fontWeight: 700, whiteSpace: "nowrap", top: 33, bgcolor: "background.paper", ...(YELLOW_COLS.has(i) ? { backgroundImage: "linear-gradient(rgba(255,214,0,0.18), rgba(255,214,0,0.18))" } : {}) }}>
                    {t(`headers.${h}`)}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {data.blocks.map((b) => (
                <React.Fragment key={b.client}>
                  <TableRow data-tour="monthly-block">
                    <TableCell colSpan={HEADERS.length} sx={{ fontWeight: 800, bgcolor: "action.selected" }}>
                      {b.client} — {t("blockTotals", { orders: b.orders, tons: t3(b.tons) })}
                    </TableCell>
                  </TableRow>
                  {b.rows.map((r) => (
                    <TableRow key={`${r.orderId}:${r.shipmentId ?? ""}`} hover sx={{ cursor: "pointer" }} onClick={() => open(r)} data-tour="monthly-row">
                      {cells(r)}
                    </TableRow>
                  ))}
                </React.Fragment>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      <Popover open={!!note} anchorReference="anchorPosition" anchorPosition={note?.pos} onClose={() => setNote(null)} onClick={(e) => e.stopPropagation()}>
        <Box sx={{ p: 1.5, width: 320 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            {note?.row.managementNo} — {t("notes")}
          </Typography>
          <TextField autoFocus fullWidth multiline minRows={3} size="small" placeholder={t("notePlaceholder")} value={note?.text ?? ""} onChange={(e) => setNote((n) => (n ? { ...n, text: e.target.value } : n))} />
          <Stack direction="row" justifyContent="flex-end" spacing={1} sx={{ mt: 1 }}>
            <Button size="small" onClick={() => setNote(null)}>
              {t("cancel")}
            </Button>
            <Button size="small" variant="contained" onClick={() => void saveNote()}>
              {t("save")}
            </Button>
          </Stack>
        </Box>
      </Popover>
    </Box>
  );
}
