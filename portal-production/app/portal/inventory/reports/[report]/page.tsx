"use client";

// One of the ten legacy Inventory Reports (guru 2026-11-25). Which one comes from the
// slug; everything that differs between them — its prompts, its columns, its totals —
// lives in helpers/inventoryReports.ts, so this page is the same page ten times over.
//
// Built like the sales report page (app/portal/reports/sales): a filter card, the
// figures in a PageTable, and the shared Print / Export button over one export model.
// Server: GET /inventory-reports/<slug> (api-server-production/src/inventory-reports).

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import {
  Alert, Box, Breadcrumbs, Checkbox, CircularProgress, FormControlLabel, Link as MuiLink, MenuItem,
  Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography,
} from "@mui/material";
import PageTable, { DEFAULT_PAGE_SIZE } from "@/components/PageTable";
import DateInput from "@/components/DateInput";
import { request } from "@/helpers/request";
import { todayIso } from "@/helpers/orgToday";
import { useOrganization } from "@/app/portal/hooks/useOrganization";
import { ReportPrintExportButton } from "@/app/portal/accounting/_lib/report-export";
import {
  cellText, inventoryReportModel, money, paperDate, periodLine, qty, reportBySlug, rowsOf,
  type ReportColumn, type ReportSpec,
} from "@/helpers/inventoryReports";

const firstOfMonth = (iso: string) => `${iso.slice(0, 8)}01`;

export default function InventoryReportPage() {
  const params = useParams<{ report: string }>();
  const router = useRouter();
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const spec: ReportSpec | undefined = reportBySlug(String(params?.report || ""));

  const today = todayIso();
  // A report about outstanding paperwork opens on every date; a report about a
  // period opens on this month.
  const allDates = spec?.defaultRange === "all";
  const [from, setFrom] = useState(allDates ? "" : firstOfMonth(today));
  const [to, setTo] = useState(allDates ? "" : today);
  const [categoryId, setCategoryId] = useState("");
  const [supplier, setSupplier] = useState("");
  const [assetId, setAssetId] = useState("");
  const [includeZero, setIncludeZero] = useState(false);
  const [belowOnly, setBelowOnly] = useState(true);
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(DEFAULT_PAGE_SIZE);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<any>({});

  const has = useCallback((k: string) => !!spec?.filters.includes(k as any), [spec]);

  // The category picker is shared by four of the reports.
  useEffect(() => {
    if (!has("category")) return;
    let gone = false;
    (async () => {
      try {
        const token = await getToken();
        const res: any = await request({ path: "/inventory-reports/categories", method: "GET", ownError: true }, {}, token ?? undefined);
        const body = res?.data ?? res;
        if (!gone && Array.isArray(body?.categories)) setCategories(body.categories);
      } catch {
        /* the report still runs without the picker */
      }
    })();
    return () => { gone = true; };
  }, [has, getToken]);

  useEffect(() => {
    if (!spec) return;
    let gone = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const token = await getToken();
        const qs = new URLSearchParams();
        if (has("dateRange")) { if (from) qs.set("from", from); if (to) qs.set("to", to); }
        if (has("category") && categoryId) qs.set("categoryId", categoryId);
        if (has("supplier") && supplier) qs.set("supplier", supplier);
        if (has("product") && assetId) qs.set("assetId", assetId);
        if (has("includeZero")) qs.set("includeZero", String(includeZero));
        if (has("belowOnly")) qs.set("belowOnly", String(belowOnly));
        const res: any = await request({ path: `${spec.path}?${qs.toString()}`, method: "GET", ownError: true }, {}, token ?? undefined);
        const body = res?.data && (Array.isArray(res.data.rows) || res.data.totals) ? res.data : res;
        if (res?.success === false || !body || !Array.isArray(body.rows)) throw new Error(res?.message || "Could not load the report");
        if (!gone) { setData(body); setPage(1); }
      } catch (e: any) {
        const m = e?.message;
        if (!gone) setError((Array.isArray(m) ? m.join(". ") : m) || "Could not load the report");
      } finally {
        if (!gone) setLoading(false);
      }
    })();
    return () => { gone = true; };
  }, [spec, has, from, to, categoryId, supplier, assetId, includeZero, belowOnly, getToken]);

  const rows = useMemo(() => (spec && data ? rowsOf(spec, data) : []), [spec, data]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r: any) => Object.values(r).some((v) => String(v ?? "").toLowerCase().includes(q)));
  }, [rows, search]);
  useEffect(() => setPage(1), [search]);
  const paged = useMemo(() => visible.slice((page - 1) * limit, page * limit), [visible, page, limit]);

  const columns = useMemo(() => {
    if (!spec) return [];
    return spec.columns.map((c: ReportColumn) => ({
      accessorKey: c.key,
      header: c.label,
      cell: ({ row }: any) => {
        const text = cellText(c, row.original);
        const numeric = c.type === "money" || c.type === "qty" || c.type === "blank";
        return (
          <Box
            sx={{
              textAlign: numeric ? "right" : "left",
              fontVariantNumeric: "tabular-nums",
              fontWeight: row.original.__kind === "subtotal" ? 700 : undefined,
              // The count sheet's two blank columns are there to be written in by hand.
              ...(c.type === "blank" ? { minWidth: 90, borderBottom: "1px dashed", borderColor: "divider", height: 20 } : {}),
            }}
          >
            {text}
          </Box>
        );
      },
    }));
  }, [spec]);

  if (!spec) {
    return (
      <Box sx={{ p: { xs: 1.5, md: 3 } }}>
        <Alert severity="warning">
          There is no such inventory report.{" "}
          <MuiLink component="button" onClick={() => router.push("/portal/inventory/reports")}>Back to Inventory Reports</MuiLink>
        </Alert>
      </Box>
    );
  }

  const metaLines = [
    ...(has("dateRange") ? [`Period : ${periodLine(from, to)}`] : []),
    ...(has("category") ? [`Category : ${categoryId ? categories.find((c) => c.id === categoryId)?.name || categoryId : "All"}`] : []),
    ...(has("supplier") && supplier ? [`Supplier : ${supplier}`] : []),
    ...(has("product") && assetId ? [`Product : ${(data?.products || []).find((p: any) => p.assetId === assetId)?.label || assetId}`] : []),
    `Printed : ${paperDate(today)}`,
  ];

  // The TOTAL line, as a compact strip: only the columns that actually carry a
  // total, each under its own column name. (A full second header row repeating
  // all ten columns to carry three figures was unreadable.)
  const totals = spec.total && data ? spec.total(data, rows) : null;
  const totalItems = totals
    ? spec.columns
        .filter((c) => typeof (totals as any)[c.key] === "number")
        .map((c) => ({ label: c.label, value: c.type === "money" ? money((totals as any)[c.key]) : qty((totals as any)[c.key]) }))
    : [];

  return (
    <Box sx={{ p: { xs: 1.5, md: 3 }, display: "flex", flexDirection: "column", gap: 2 }}>
      <Breadcrumbs sx={{ fontSize: 13 }}>
        <MuiLink component="button" underline="hover" color="inherit" onClick={() => router.push("/portal/inventory/reports")}>
          Inventory Reports
        </MuiLink>
        <Typography sx={{ fontSize: 13 }} color="text.primary">{spec.title}</Typography>
      </Breadcrumbs>

      <Stack direction="row" alignItems="center" spacing={1}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>{spec.title}</Typography>
        <Box sx={{ flex: 1 }} />
        <ReportPrintExportButton
          getModel={() => (data ? inventoryReportModel(spec, data, { orgName: organization?.name || "", metaLines }) : null)}
        />
      </Stack>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction={{ xs: "column", sm: "row" }} gap={2} alignItems={{ xs: "stretch", sm: "flex-end" }} flexWrap="wrap">
          {has("dateRange") && (
            <>
              <DateInput size="small" label="From" InputLabelProps={{ shrink: true }} value={from} onChange={(e: any) => setFrom(e.target.value)} />
              <DateInput size="small" label="To" InputLabelProps={{ shrink: true }} value={to} onChange={(e: any) => setTo(e.target.value)} />
            </>
          )}
          {has("category") && (
            <TextField select size="small" label="Category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
              sx={{ minWidth: 200 }} SelectProps={{ displayEmpty: true }} InputLabelProps={{ shrink: true }}>
              <MenuItem value="">All</MenuItem>
              {categories.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
            </TextField>
          )}
          {has("supplier") && (
            <TextField select size="small" label="Supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)}
              sx={{ minWidth: 220 }} SelectProps={{ displayEmpty: true }} InputLabelProps={{ shrink: true }}>
              <MenuItem value="">All</MenuItem>
              {(data?.suppliers || []).map((s: string) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
            </TextField>
          )}
          {has("product") && (
            <TextField select size="small" label="Product" value={assetId} onChange={(e) => setAssetId(e.target.value)}
              sx={{ minWidth: 280 }} SelectProps={{ displayEmpty: true }} InputLabelProps={{ shrink: true }}>
              <MenuItem value="">All products</MenuItem>
              {(data?.products || []).map((p: any) => <MenuItem key={p.assetId} value={p.assetId}>{p.label}</MenuItem>)}
            </TextField>
          )}
          {has("includeZero") && (
            <FormControlLabel control={<Checkbox size="small" checked={includeZero} onChange={(e) => setIncludeZero(e.target.checked)} />} label="Include items with no stock" />
          )}
          {has("belowOnly") && (
            <FormControlLabel control={<Checkbox size="small" checked={belowOnly} onChange={(e) => setBelowOnly(e.target.checked)} />} label="Only at or below the level" />
          )}
          {loading && <CircularProgress size={22} sx={{ alignSelf: "center" }} />}
        </Stack>
      </Paper>

      {error && <Alert severity="warning" onClose={() => setError(null)}>{error}</Alert>}

      {totalItems.length > 0 && (
        <Paper variant="outlined" sx={{ px: 2, py: 1.5 }}>
          <Stack direction="row" gap={4} flexWrap="wrap" alignItems="baseline">
            <Typography variant="overline" sx={{ color: "text.secondary", letterSpacing: 1 }}>Total</Typography>
            {totalItems.map((t) => (
              <Stack key={t.label} direction="row" gap={1} alignItems="baseline">
                <Typography variant="body2" sx={{ color: "text.secondary" }}>{t.label}</Typography>
                <Typography variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{t.value}</Typography>
              </Stack>
            ))}
          </Stack>
        </Paper>
      )}

      {data && (
        <PageTable
          columns={columns}
          data={paged}
          tableName={spec.title}
          loading={loading}
          page={page}
          limit={limit}
          search={search}
          filters={filters}
          setPage={setPage}
          setLimit={setLimit}
          setSearch={setSearch}
          setFilters={setFilters}
          pageCount={Math.max(1, Math.ceil(visible.length / limit))}
          totalDocs={visible.length}
          rowSx={(r: any) => (r?.__kind === "subtotal" ? { bgcolor: "action.hover" } : {})}
          noSelectionColumn
        />
      )}

      {/* Stock Movement Analysis with one product picked prints every movement behind the line. */}
      {spec.slug === "stock-movement" && assetId && (data?.detail || []).length > 0 && (
        <Paper variant="outlined" sx={{ p: 2, overflowX: "auto" }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Movements</Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                {["Date", "Doc No.", "Type", "Supplier / Customer", "In", "Out", "Balance", "Unit Price"].map((h, i) => (
                  <TableCell key={h} sx={{ fontWeight: 700, textAlign: i >= 4 ? "right" : "left" }}>{h}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {(data.detail as any[]).map((m, i) => (
                <TableRow key={`${m.documentId}-${i}`}>
                  <TableCell>{paperDate(m.date)}</TableCell>
                  <TableCell>{m.number}</TableCell>
                  <TableCell>{m.type}</TableCell>
                  <TableCell>{m.party}</TableCell>
                  <TableCell sx={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{m.qtyIn ? qty(m.qtyIn) : ""}</TableCell>
                  <TableCell sx={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{m.qtyOut ? qty(m.qtyOut) : ""}</TableCell>
                  <TableCell sx={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{qty(m.balance)}</TableCell>
                  <TableCell sx={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(m.unitPrice)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}

      {spec.note && (
        <Typography variant="caption" sx={{ color: "text.secondary" }}>{spec.note}</Typography>
      )}
    </Box>
  );
}
