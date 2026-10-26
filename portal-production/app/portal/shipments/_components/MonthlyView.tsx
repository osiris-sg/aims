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

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Box, Button, Chip, CircularProgress, FormControlLabel, IconButton, Menu, MenuItem, Paper, Popover, Stack, Switch, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Tooltip, Typography } from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useShipmentsApi, type MonthlyQuery, type MonthlyRow } from "../_lib/api";
import { orderHref } from "../_lib/inbox-threads";
import { uiLangOf } from "../_lib/inbox-cards";
import { toast } from "../_lib/toast";

const YELLOW = { bgcolor: "rgba(255, 214, 0, 0.18)" };
const GROUPS = [
  { title: "Order information", ja: "注文情報", cols: 9, tour: "monthly-group-order" },
  { title: "Supplier information", ja: "仕入先情報", cols: 4, tour: "monthly-group-supplier" },
  { title: "Shipment information", ja: "出荷情報", cols: 5, tour: "monthly-group-shipment" },
];
const HEADERS = ["Client", "Order No.", "Order Date", "Billet Type", "Supplier", "Ton", "Shipment Month", "Delivery Month", "Order Status", "Supplier Contract No", "Order Date", "Order ton", "Supplier Status", "管理NO", "BL Number", "ETD", "ETA", "Notes"];
const HEADERS_JA: Record<number, string> = { 8: "注文ステータス", 12: "仕入ステータス", 17: "備考" };
const YELLOW_COLS = new Set([8, 12]);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const month = (ym: string | null) => (ym && /^\d{4}-\d{2}$/.test(ym) ? `${MON[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}` : (ym ?? ""));
const dmy = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "");
const t3 = (n: number | null) => (n === null || n === undefined ? "" : Number(n).toLocaleString("en-US", { maximumFractionDigits: 3 }));
export const addMonth = (ym: string, n: number) => {
  const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5)) - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
export const tokyoMonth = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);

/** Supplier status words in Japanese (the API sends the English label + the code). */
const SUPPLIER_JA: Record<string, string> = { NONE: "—", PI_RECEIVED: "PI受領", DEPOSIT_PAID: "前払金支払済", SHIPPED: "出荷済（B/L発行）", CI_RECEIVED: "CI受領", BALANCE_PAID: "残金支払済", DONE: "完了" };

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
  const [lang, setLang] = useState<"en" | "ja">("en");
  useEffect(() => setLang(uiLangOf(typeof navigator !== "undefined" ? navigator.language : null)), []);
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
      toast.error(e?.message || "Export failed");
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
      toast.success("Note saved");
    } catch (e: any) {
      toast.error(e?.message || "Could not save the note");
    }
  };
  const stageLabel = (r: MonthlyRow) => {
    const ja = data?.options.stages?.find((s) => s.code === r.orderStage)?.ja;
    return lang === "ja" && ja ? ja : r.orderStageLabel;
  };
  const supplierLabel = (r: MonthlyRow) => (lang === "ja" ? (SUPPLIER_JA[r.supplierStage] ?? r.supplierStageLabel) : r.supplierStageLabel);

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
          <Tooltip title={r.shipmentStatus ? `Current step: ${r.shipmentStatus}` : ""} disableInteractive>
            <span>
              {stageLabel(r)}
              {r.unconfirmed && (
                <Typography component="span" variant="caption" color="warning.main" sx={{ ml: 0.5 }}>
                  check
                </Typography>
              )}
            </span>
          </Tooltip>
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
          {r.notes ?? (r.shipmentId ? "+ note" : "")}
        </TableCell>,
      ];
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lang, data?.options.stages]
  );

  return (
    <Box sx={{ width: "100%", maxWidth: "100%", minWidth: 0, boxSizing: "border-box", display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }} data-tour="monthly-list">
      <Paper variant="outlined" sx={{ px: 1.5, py: 1, mb: 1.5 }} data-tour="monthly-filters">
        <Stack direction="row" alignItems="center" spacing={1.25} flexWrap="wrap" useFlexGap>
          <Stack direction="row" alignItems="center" spacing={0.5} data-tour="monthly-month-picker">
            <IconButton size="small" onClick={() => step(-1)} aria-label="Previous month">
              <ChevronLeftIcon />
            </IconButton>
            <TextField type="month" size="small" label={range ? "From" : lang === "ja" ? "月" : "Month"} value={q.from ?? ""} onChange={(e) => set("from", e.target.value)} InputLabelProps={{ shrink: true }} sx={{ width: 160 }} />
            {range && <TextField type="month" size="small" label="To" value={q.to ?? ""} onChange={(e) => set("to", e.target.value)} InputLabelProps={{ shrink: true }} sx={{ width: 160 }} />}
            <IconButton size="small" onClick={() => step(1)} aria-label="Next month">
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
              label={lang === "ja" ? "期間" : "Range"}
            />
            {q.from !== now && (
              <Button size="small" onClick={() => setQ((p) => ({ ...p, from: now, to: range ? addMonth(now, 2) : now }))} sx={{ textTransform: "none" }}>
                {lang === "ja" ? "今月" : "This month"}
              </Button>
            )}
          </Stack>
          <TextField select size="small" label="Month by" value={q.basis ?? "delivery"} onChange={(e) => set("basis", e.target.value)} sx={{ minWidth: 140 }}>
            <MenuItem value="delivery">Delivery month</MenuItem>
            <MenuItem value="ship">Shipment month</MenuItem>
          </TextField>
          {!customerId && (
            <TextField select size="small" label="Client" value={clientId ?? ""} onChange={(e) => (onClientChange ? onClientChange(e.target.value) : set("customerId", e.target.value))} sx={{ minWidth: 120 }}>
              <MenuItem value="">All</MenuItem>
              {(data?.options.clients ?? []).map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.name}
                </MenuItem>
              ))}
            </TextField>
          )}
          {!supplierId && (
            <TextField select size="small" label="Supplier" value={q.supplier ?? ""} onChange={(e) => set("supplier", e.target.value)} sx={{ minWidth: 120 }}>
              <MenuItem value="">All</MenuItem>
              {(data?.options.suppliers ?? []).map((s) => (
                <MenuItem key={s} value={s}>
                  {s}
                </MenuItem>
              ))}
            </TextField>
          )}
          <TextField select size="small" label="Grade" value={q.grade ?? ""} onChange={(e) => set("grade", e.target.value)} sx={{ minWidth: 100 }}>
            <MenuItem value="">All</MenuItem>
            {(data?.options.grades ?? []).map((g) => (
              <MenuItem key={g} value={g}>
                {g}
              </MenuItem>
            ))}
          </TextField>
          <TextField select size="small" label={lang === "ja" ? "注文ステータス" : "Order Status"} value={q.stage ?? ""} onChange={(e) => set("stage", e.target.value)} sx={{ minWidth: 170 }}>
            <MenuItem value="">All</MenuItem>
            {(data?.options.stages ?? []).map((s) => (
              <MenuItem key={s.code} value={s.code}>
                {lang === "ja" ? s.ja : s.en}
              </MenuItem>
            ))}
          </TextField>
          <Stack direction="row" alignItems="center" spacing={1.25} sx={{ ml: "auto" }}>
            {data && (
              <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "nowrap" }} data-tour="monthly-totals">
                {data.totals.orders} order{data.totals.orders === 1 ? "" : "s"} · {data.totals.rows} row{data.totals.rows === 1 ? "" : "s"} · {t3(data.totals.tons)} t
              </Typography>
            )}
            <Button variant="contained" startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <DownloadIcon />} disabled={busy || !data?.totals.rows} onClick={(e) => setMenu(e.currentTarget)} sx={{ textTransform: "none" }} data-tour="monthly-export">
              Export
            </Button>
            <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)}>
              <MenuItem onClick={() => void exportAs("xlsx")}>Excel (.xlsx) — their layout</MenuItem>
              <MenuItem onClick={() => void exportAs("csv")}>CSV (.csv)</MenuItem>
            </Menu>
          </Stack>
        </Stack>
      </Paper>
      {list.isError && <Alert severity="error">{(list.error as Error)?.message || "Could not load the list"}</Alert>}
      {list.isLoading ? (
        <CircularProgress />
      ) : !data?.blocks.length ? (
        <Paper variant="outlined" sx={{ p: 3, textAlign: "center" }}>
          <Typography color="text.secondary">
            No {bucket === "pending" ? "pending " : bucket === "completed" ? "completed " : ""}orders {query.q ? `matching “${query.q}” ` : ""}in {range ? "this range" : month(q.from ?? now)}.
          </Typography>
          {!!data?.elsewhere?.length && (
            <Stack direction="row" spacing={1} justifyContent="center" alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }} data-tour="monthly-elsewhere">
              <Typography variant="body2" color="text.secondary">
                Found in:
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
              {data.counts.all} order{data.counts.all === 1 ? "" : "s"} in the All tab.
            </Typography>
          )}
        </Paper>
      ) : (
        <TableContainer component={Paper} variant="outlined" sx={{ maxWidth: "100%", overflow: "auto", maxHeight: "calc(100vh - 330px)" }}>
          <Table size="small" stickyHeader sx={{ "& td, & th": { borderRight: "1px solid", borderColor: "divider", px: 0.75, py: 0.5, fontSize: 12.5, verticalAlign: "top" } }}>
            <TableHead>
              <TableRow>
                {GROUPS.map((g) => (
                  <TableCell key={g.title} colSpan={g.cols} align="center" sx={{ fontWeight: 800, bgcolor: "background.paper" }} data-tour={g.tour}>
                    {lang === "ja" ? g.ja : g.title}
                  </TableCell>
                ))}
              </TableRow>
              <TableRow>
                {HEADERS.map((h, i) => (
                  <TableCell key={i} sx={{ fontWeight: 700, whiteSpace: "nowrap", top: 33, bgcolor: "background.paper", ...(YELLOW_COLS.has(i) ? { backgroundImage: "linear-gradient(rgba(255,214,0,0.18), rgba(255,214,0,0.18))" } : {}) }}>
                    {lang === "ja" ? (HEADERS_JA[i] ?? h) : h}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {data.blocks.map((b) => (
                <React.Fragment key={b.client}>
                  <TableRow data-tour="monthly-block">
                    <TableCell colSpan={HEADERS.length} sx={{ fontWeight: 800, bgcolor: "action.selected" }}>
                      {b.client} — {b.orders} order{b.orders === 1 ? "" : "s"} · {t3(b.tons)} t
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
            {note?.row.managementNo} — {lang === "ja" ? "備考" : "Notes"}
          </Typography>
          <TextField autoFocus fullWidth multiline minRows={3} size="small" placeholder="e.g. 11/9 2trks 40T · STORE until DEC?" value={note?.text ?? ""} onChange={(e) => setNote((n) => (n ? { ...n, text: e.target.value } : n))} />
          <Stack direction="row" justifyContent="flex-end" spacing={1} sx={{ mt: 1 }}>
            <Button size="small" onClick={() => setNote(null)}>
              Cancel
            </Button>
            <Button size="small" variant="contained" onClick={() => void saveNote()}>
              Save
            </Button>
          </Stack>
        </Box>
      </Popover>
    </Box>
  );
}
