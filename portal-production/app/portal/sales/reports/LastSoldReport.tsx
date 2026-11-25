"use client";

// Legacy "Last Sold Report" (guru 2026-11-25). Each item's most recent sale in
// the range: code, description, last sold date, who bought it, qty and price.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Typography } from "@mui/material";
import { toast } from "react-toastify";
import { useAccountingApi } from "@/app/portal/accounting/_lib/api";
import ReportShell, { downloadCsv } from "@/app/portal/accounting/_lib/report-shell/ReportShell";
import ReportTable, { ReportRow, fmtDate } from "@/app/portal/accounting/_lib/report-shell/ReportTable";
import { onReportDate } from "@/app/portal/accounting/_lib/report-shell/reportDate";
import DateInput from "@/components/DateInput";

const fmt = (n: number) => (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const unwrap = (r: any) => { let o = r; while (o && typeof o === "object" && o.success !== undefined && o.data !== undefined) o = o.data; return o; };

type Row = { code: string; description: string; date: string; customer: string; qty: number; price: number };

export default function LastSoldReport() {
  const { request } = useAccountingApi();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<{ rows: Row[] } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      setData(unwrap(await request(`/sales-reports/last-sold${qs.toString() ? `?${qs.toString()}` : ""}`)));
    } catch (e: any) {
      toast.error(e?.message || "Failed to load the last sold report");
    } finally {
      setLoading(false);
    }
  }, [request, from, to]);

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const columns = useMemo(() => [
    { key: "code", label: "Code", align: "left" as const, width: 130 },
    { key: "desc", label: "Description", align: "left" as const },
    { key: "date", label: "Last Sold", align: "left" as const, width: 110 },
    { key: "customer", label: "Customer", align: "left" as const, width: 220 },
    { key: "qty", label: "Qty", align: "right" as const, width: 80 },
    { key: "price", label: "Unit Price", align: "right" as const, width: 110 },
  ], []);

  const rows = useMemo<ReportRow[]>(() => {
    if (!data) return [];
    return data.rows.map((r, i) => ({ kind: "row", key: `${r.code}-${i}`, cells: [r.code || "—", r.description, fmtDate(r.date), r.customer, String(r.qty), fmt(r.price)] }));
  }, [data]);

  const exportCsv = () => {
    if (!data) return;
    downloadCsv("Last-Sold-Report.csv", [["Code", "Description", "Last Sold", "Customer", "Qty", "Unit Price"], ...data.rows.map((r) => [r.code, r.description, r.date, r.customer, r.qty, fmt(r.price)])]);
  };

  return (
    <ReportShell
      title="Last Sold Report"
      loading={loading}
      onUpdate={load}
      filters={
        <>
          <Box><Typography variant="caption" sx={{ fontWeight: 700 }}>From Period</Typography><DateInput size="small" value={from} onChange={onReportDate(setFrom)} sx={{ width: 160, mt: 0.25, display: "block" }} /></Box>
          <Box><Typography variant="caption" sx={{ fontWeight: 700 }}>To Period</Typography><DateInput size="small" value={to} onChange={onReportDate(setTo)} sx={{ width: 160, mt: 0.25, display: "block" }} /></Box>
        </>
      }
      headerLines={data ? [`From Date : ${from ? fmtDate(from) : "—"}      To Date : ${to ? fmtDate(to) : "—"}`] : []}
      footerInfo={data ? `${data.rows.length} ${data.rows.length === 1 ? "item" : "items"}` : ""}
      onExportCsv={data?.rows.length ? exportCsv : undefined}
    >
      {data ? <ReportTable columns={columns} rows={rows} /> : null}
    </ReportShell>
  );
}
