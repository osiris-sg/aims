/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Round AG (ADH) — Sales › Monthly list: ADH's own spreadsheet as a page. One block per client (Kato, SUS, Hoei, then
// the others), one row per shipment (an order with no shipment yet = one row; an order with 3 B/Ls = 3 rows whose order
// / supplier cells are shown once, merged). Three column groups — Order information · Supplier information · Shipment
// information — and the two yellow Status columns (computed: order status; PI / CI paid from steps 1 and 6). 管理NO is
// the one editable cell. Filters: delivery / shipment month range (default: this month + the next two), client,
// supplier, grade, status. Export: .xlsx in their layout, CSV. A row opens the order on that shipment's current step.

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Box, Button, CircularProgress, Menu, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useShipmentsApi, type MonthlyQuery, type MonthlyRow } from "../_lib/api";
import { orderHref } from "../_lib/inbox-threads";
import { toast } from "../_lib/toast";

const YELLOW = { bgcolor: "rgba(255, 214, 0, 0.18)" };
const GROUPS = [
  { title: "Order information", cols: 9, tour: "monthly-group-order" },
  { title: "Supplier information", cols: 4, tour: "monthly-group-supplier" },
  { title: "Shipment information", cols: 5, tour: "monthly-group-shipment" },
];
const HEADERS = ["Client", "Order No.", "Order Date", "Billet Type", "Supplier", "Ton", "Shipment Month", "Delivery Month", "Status", "Supplier Contract No", "Order Date", "Order ton", "Status", "Order Status", "管理NO", "BL Number", "ETD", "ETA"];
const YELLOW_COLS = new Set([8, 12]);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const month = (ym: string | null) => (ym && /^\d{4}-\d{2}$/.test(ym) ? `${MON[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}` : ym ?? "");
const dmy = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "");
const t3 = (n: number | null) => (n === null || n === undefined ? "" : Number(n).toLocaleString("en-US", { maximumFractionDigits: 3 }));
const addMonth = (ym: string, n: number) => {
  const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5)) - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const tokyoMonth = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);

function download(fileName: string, contentType: string, base64: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: contentType }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** 管理NO: click to edit, Enter / blur saves, Esc cancels. Only on shipment rows. */
function ManagementNoCell({ r, onSaved }: { r: MonthlyRow; onSaved: () => void }) {
  const api = useShipmentsApi();
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState(r.managementNo ?? "");
  useEffect(() => setV(r.managementNo ?? ""), [r.managementNo]);
  if (!r.shipmentId) return null;
  const save = async () => {
    setEdit(false);
    if ((r.managementNo ?? "") === v.trim()) return;
    try {
      await api.setManagementNo(r.shipmentId!, v.trim() || null);
      onSaved();
    } catch (e: any) {
      toast.error(e?.message || "Could not save 管理NO");
      setV(r.managementNo ?? "");
    }
  };
  return edit ? (
    <TextField
      size="small"
      autoFocus
      value={v}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => void save()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") void save();
        if (e.key === "Escape") {
          setV(r.managementNo ?? "");
          setEdit(false);
        }
      }}
      inputProps={{ style: { padding: "2px 6px", fontSize: 13 }, maxLength: 60 }}
      sx={{ width: 110 }}
    />
  ) : (
    <Box
      component="span"
      onClick={(e) => {
        e.stopPropagation();
        setEdit(true);
      }}
      title="Click to edit 管理NO"
      sx={{ cursor: "text", display: "inline-block", minWidth: 60, minHeight: 18, borderBottom: "1px dashed", borderColor: "divider", color: r.managementNo ? "text.primary" : "text.disabled" }}
      data-tour="monthly-kanri"
    >
      {r.managementNo || "—"}
    </Box>
  );
}

export default function MonthlyListPage() {
  const api = useShipmentsApi();
  const qc = useQueryClient();
  const router = useRouter();
  const now = tokyoMonth();
  const [q, setQ] = useState<MonthlyQuery>({ from: now, to: addMonth(now, 2), basis: "delivery" });
  const list = useQuery({ queryKey: ["trade-monthly-list", q], queryFn: () => api.monthlyList(q), staleTime: 30_000 });
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);
  const data = list.data;
  const set = (k: keyof MonthlyQuery, v: string) => setQ((p) => ({ ...p, [k]: v || undefined }));
  const exportAs = async (format: "xlsx" | "csv") => {
    setMenu(null);
    setBusy(true);
    try {
      const f = await api.monthlyExport(q, format);
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
  const refresh = () => void qc.invalidateQueries({ queryKey: ["trade-monthly-list"] });

  const cells = useMemo(
    () => (r: MonthlyRow) => {
      const o = r.first;
      const span = o ? r.span : 0;
      // The order / supplier cells sit on the order's first row, spanning its shipment rows (the merged look).
      const merged = (i: number, v: React.ReactNode, sx: object = {}) => (o ? <TableCell key={i} rowSpan={span} sx={{ verticalAlign: "top", ...(YELLOW_COLS.has(i) ? YELLOW : {}), ...sx }}>{v}</TableCell> : null);
      return [
        merged(0, <b>{r.client}</b>),
        <TableCell key={1} sx={{ fontWeight: 700, whiteSpace: "nowrap" }}>{r.shipmentRef ?? r.orderNo}</TableCell>,
        merged(2, dmy(r.orderDate), { whiteSpace: "nowrap" }),
        merged(3, r.billetType),
        merged(4, r.supplier),
        merged(5, t3(r.ton), { textAlign: "right", fontVariantNumeric: "tabular-nums" }),
        merged(6, month(r.shipMonth), { whiteSpace: "nowrap" }),
        merged(7, month(r.deliveryMonth), { whiteSpace: "nowrap" }),
        merged(8, r.orderStatus, { fontWeight: 600 }),
        merged(9, r.supplierContractNo ?? ""),
        merged(10, dmy(r.supplierOrderDate), { whiteSpace: "nowrap" }),
        merged(11, t3(r.supplierTon), { textAlign: "right", fontVariantNumeric: "tabular-nums" }),
        merged(12, r.supplierStatus, { fontWeight: 600 }),
        <TableCell key={13}>{r.shipmentStatus ?? ""}</TableCell>,
        <TableCell key={14}><ManagementNoCell r={r} onSaved={refresh} /></TableCell>,
        <TableCell key={15} sx={{ whiteSpace: "nowrap" }}>{r.blNumber ?? ""}</TableCell>,
        <TableCell key={16} sx={{ whiteSpace: "nowrap" }}>{dmy(r.etd)}</TableCell>,
        <TableCell key={17} sx={{ whiteSpace: "nowrap" }}>{dmy(r.eta)}</TableCell>,
      ];
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <Box sx={{ p: { xs: 1.5, md: 3 }, maxWidth: 1800, mx: "auto" }} data-tour="monthly-list">
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }} flexWrap="wrap" useFlexGap>
        <Typography variant="h6" sx={{ fontWeight: 700, flex: 1 }}>
          Monthly order list
        </Typography>
        <Button variant="contained" startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <DownloadIcon />} disabled={busy || !data?.totals.rows} onClick={(e) => setMenu(e.currentTarget)} sx={{ textTransform: "none" }} data-tour="monthly-export">
          Export
        </Button>
        <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)}>
          <MenuItem onClick={() => void exportAs("xlsx")}>Excel (.xlsx) — their layout</MenuItem>
          <MenuItem onClick={() => void exportAs("csv")}>CSV (.csv)</MenuItem>
        </Menu>
      </Stack>
      <Paper variant="outlined" sx={{ p: 1.5, mb: 1.5 }} data-tour="monthly-filters">
        <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap alignItems="center">
          <TextField select size="small" label="Month by" value={q.basis ?? "delivery"} onChange={(e) => set("basis", e.target.value)} sx={{ minWidth: 150 }}>
            <MenuItem value="delivery">Delivery month</MenuItem>
            <MenuItem value="ship">Shipment month</MenuItem>
          </TextField>
          <TextField type="month" size="small" label="From" value={q.from ?? ""} onChange={(e) => set("from", e.target.value)} InputLabelProps={{ shrink: true }} />
          <TextField type="month" size="small" label="To" value={q.to ?? ""} onChange={(e) => set("to", e.target.value)} InputLabelProps={{ shrink: true }} />
          <TextField select size="small" label="Client" value={q.customerId ?? ""} onChange={(e) => set("customerId", e.target.value)} sx={{ minWidth: 140 }}>
            <MenuItem value="">All</MenuItem>
            {(data?.options.clients ?? []).map((c) => (
              <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
            ))}
          </TextField>
          <TextField select size="small" label="Supplier" value={q.supplier ?? ""} onChange={(e) => set("supplier", e.target.value)} sx={{ minWidth: 130 }}>
            <MenuItem value="">All</MenuItem>
            {(data?.options.suppliers ?? []).map((s) => (
              <MenuItem key={s} value={s}>{s}</MenuItem>
            ))}
          </TextField>
          <TextField select size="small" label="Grade" value={q.grade ?? ""} onChange={(e) => set("grade", e.target.value)} sx={{ minWidth: 110 }}>
            <MenuItem value="">All</MenuItem>
            {(data?.options.grades ?? []).map((g) => (
              <MenuItem key={g} value={g}>{g}</MenuItem>
            ))}
          </TextField>
          <TextField select size="small" label="Status" value={q.status ?? ""} onChange={(e) => set("status", e.target.value)} sx={{ minWidth: 140 }}>
            <MenuItem value="">All</MenuItem>
            {["Open", "Unconfirmed", "Completed"].map((s) => (
              <MenuItem key={s} value={s}>{s}</MenuItem>
            ))}
          </TextField>
          {data && (
            <Typography variant="body2" color="text.secondary" sx={{ ml: "auto" }}>
              {data.totals.orders} order{data.totals.orders === 1 ? "" : "s"} · {data.totals.rows} row{data.totals.rows === 1 ? "" : "s"} · {t3(data.totals.tons)} t
            </Typography>
          )}
        </Stack>
      </Paper>
      {list.isError && <Alert severity="error">{(list.error as Error)?.message || "Could not load the list"}</Alert>}
      {list.isLoading ? (
        <CircularProgress />
      ) : !data?.blocks.length ? (
        <Paper variant="outlined" sx={{ p: 3, textAlign: "center" }}>
          <Typography color="text.secondary">No orders in this range.</Typography>
        </Paper>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small" sx={{ "& td, & th": { borderRight: "1px solid", borderColor: "divider", px: 1, py: 0.5, fontSize: 13 } }}>
            <TableHead>
              <TableRow>
                {GROUPS.map((g) => (
                  <TableCell key={g.title} colSpan={g.cols} align="center" sx={{ fontWeight: 800, bgcolor: "action.hover" }} data-tour={g.tour}>
                    {g.title}
                  </TableCell>
                ))}
              </TableRow>
              <TableRow>
                {HEADERS.map((h, i) => (
                  <TableCell key={i} sx={{ fontWeight: 700, whiteSpace: "nowrap", ...(YELLOW_COLS.has(i) ? YELLOW : {}) }}>
                    {h}
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
    </Box>
  );
}
