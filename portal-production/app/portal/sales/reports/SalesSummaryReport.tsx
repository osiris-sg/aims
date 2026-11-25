"use client";

// Legacy "Sales Summary By <dimension>" (guru 2026-11-25). Columns word-for-word
// from the old software: Code | Name | Total Sales | Total Cost | Nett Profit $ |
// Profit % | Referral. Profit % shows the legacy "***.**" mask when sales is 0.
// One component drives Customer / Salesman / Product / Category via `dimension`.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, MenuItem, TextField, Typography } from "@mui/material";
import { toast } from "react-toastify";
import { useAccountingApi } from "@/app/portal/accounting/_lib/api";
import ReportShell, { downloadCsv } from "@/app/portal/accounting/_lib/report-shell/ReportShell";
import ReportTable, { ReportRow, fmtDate } from "@/app/portal/accounting/_lib/report-shell/ReportTable";
import { onReportDate } from "@/app/portal/accounting/_lib/report-shell/reportDate";
import DateInput from "@/components/DateInput";

export type SalesDimension = "customer" | "salesman" | "product" | "category";

const DIM_LABEL: Record<SalesDimension, string> = {
  customer: "Customer",
  salesman: "Salesman",
  product: "Product",
  category: "Category",
};

const fmt = (n: number) => (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const unwrap = (r: any) => { let o = r; while (o && typeof o === "object" && o.success !== undefined && o.data !== undefined) o = o.data; return o; };

type Row = { code: string; name: string; totalSales: number; totalCost: number; nettProfit: number; profitPct: number | null };

export default function SalesSummaryReport({ dimension }: { dimension: SalesDimension }) {
  const { request } = useAccountingApi();
  const label = DIM_LABEL[dimension];

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [codeFrom, setCodeFrom] = useState("");
  const [codeTo, setCodeTo] = useState("");
  const [uplift, setUplift] = useState("");
  const [sort, setSort] = useState<"asc" | "desc">("asc");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<{ rows: Row[]; totals: any } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ dimension, sort });
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      if (codeFrom) qs.set("codeFrom", codeFrom);
      if (codeTo) qs.set("codeTo", codeTo);
      if (uplift) qs.set("costUpliftPct", uplift);
      const res = await request(`/sales-reports/summary?${qs.toString()}`);
      setData(unwrap(res));
    } catch (e: any) {
      toast.error(e?.message || "Failed to load the sales summary");
    } finally {
      setLoading(false);
    }
  }, [request, dimension, from, to, codeFrom, codeTo, uplift, sort]);

  const showReferral = dimension === "customer";

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const columns = useMemo(
    () => [
      { key: "code", label: "Code", align: "left" as const, width: 90 },
      { key: "name", label: "Name", align: "left" as const },
      { key: "sales", label: "Total Sales", align: "right" as const, width: 130 },
      { key: "cost", label: "Total Cost", align: "right" as const, width: 130 },
      { key: "profit", label: "Nett Profit $", align: "right" as const, width: 130 },
      { key: "pct", label: "Profit %", align: "right" as const, width: 90 },
      ...(showReferral ? [{ key: "ref", label: "Referral", align: "left" as const, width: 90 }] : []),
    ],
    [showReferral],
  );

  const tableRows = useMemo<ReportRow[]>(() => {
    if (!data) return [];
    const out: ReportRow[] = data.rows.map((r, i) => ({
      kind: "row",
      key: `${r.code}-${i}`,
      cells: [
        r.code || "—",
        r.name || "",
        fmt(r.totalSales),
        fmt(r.totalCost),
        fmt(r.nettProfit),
        r.profitPct == null ? "***.**" : fmt(r.profitPct),
        ...(showReferral ? [""] : []),
      ],
    }));
    const t = data.totals || {};
    out.push({
      kind: "total",
      key: "__total",
      cells: [
        "TOTAL",
        "",
        fmt(t.totalSales),
        fmt(t.totalCost),
        fmt(t.nettProfit),
        t.profitPct == null ? "***.**" : fmt(t.profitPct),
        ...(showReferral ? [""] : []),
      ],
    });
    return out;
  }, [data, showReferral]);

  const exportCsv = () => {
    if (!data) return;
    const head = ["Code", "Name", "Total Sales", "Total Cost", "Nett Profit $", "Profit %", ...(showReferral ? ["Referral"] : [])];
    downloadCsv(`Sales-Summary-By-${label}.csv`, [
      head,
      ...data.rows.map((r) => [r.code, r.name, fmt(r.totalSales), fmt(r.totalCost), fmt(r.nettProfit), r.profitPct == null ? "***.**" : fmt(r.profitPct), ...(showReferral ? [""] : [])]),
      ["TOTAL", "", fmt(data.totals.totalSales), fmt(data.totals.totalCost), fmt(data.totals.nettProfit), data.totals.profitPct == null ? "***.**" : fmt(data.totals.profitPct), ...(showReferral ? [""] : [])],
    ]);
  };

  return (
    <ReportShell
      title={`Sales Summary By ${label}`}
      loading={loading}
      onUpdate={load}
      filters={
        <>
          <Box>
            <Typography variant="caption" sx={{ fontWeight: 700 }}>From Period</Typography>
            <DateInput size="small" value={from} onChange={onReportDate(setFrom)} sx={{ width: 160, mt: 0.25, display: "block" }} />
          </Box>
          <Box>
            <Typography variant="caption" sx={{ fontWeight: 700 }}>To Period</Typography>
            <DateInput size="small" value={to} onChange={onReportDate(setTo)} sx={{ width: 160, mt: 0.25, display: "block" }} />
          </Box>
          <Box>
            <Typography variant="caption" sx={{ fontWeight: 700 }}>{`From ${label} code`}</Typography>
            <TextField size="small" value={codeFrom} onChange={(e) => setCodeFrom(e.target.value)} sx={{ width: 130, mt: 0.25, display: "block" }} placeholder="e.g. DA095" />
          </Box>
          <Box>
            <Typography variant="caption" sx={{ fontWeight: 700 }}>{`To ${label} code`}</Typography>
            <TextField size="small" value={codeTo} onChange={(e) => setCodeTo(e.target.value)} sx={{ width: 130, mt: 0.25, display: "block" }} placeholder="e.g. DY012" />
          </Box>
          <Box>
            <Typography variant="caption" sx={{ fontWeight: 700 }}>Product cost increased by %</Typography>
            <TextField size="small" value={uplift} onChange={(e) => setUplift(e.target.value)} sx={{ width: 110, mt: 0.25, display: "block" }} inputProps={{ inputMode: "decimal" }} placeholder="0" />
          </Box>
          <Box>
            <Typography variant="caption" sx={{ fontWeight: 700 }}>Order</Typography>
            <TextField size="small" select value={sort} onChange={(e) => setSort(e.target.value as any)} sx={{ width: 140, mt: 0.25, display: "block" }}>
              <MenuItem value="asc">Ascending</MenuItem>
              <MenuItem value="desc">Descending</MenuItem>
            </TextField>
          </Box>
        </>
      }
      headerLines={
        data
          ? [
              `From Date : ${from ? fmtDate(from) : "—"}      To Date : ${to ? fmtDate(to) : "—"}`,
              ...(Number(uplift) ? [`Product cost increased by ${uplift}%`] : []),
            ]
          : []
      }
      footerInfo={data ? `${data.rows.length} ${data.rows.length === 1 ? label.toLowerCase() : `${label.toLowerCase()}s`}` : ""}
      onExportCsv={data?.rows.length ? exportCsv : undefined}
    >
      {data ? <ReportTable columns={columns} rows={tableRows} /> : null}
    </ReportShell>
  );
}
