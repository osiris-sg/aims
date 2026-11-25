"use client";

// Legacy "Detailed Sales Analysis By <dimension>" (guru 2026-11-25). Every sales
// line grouped under its customer / salesman / product / category, with a
// sub-total per group and a grand total.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, TextField, Typography } from "@mui/material";
import { toast } from "react-toastify";
import { useAccountingApi } from "@/app/portal/accounting/_lib/api";
import ReportShell, { downloadCsv } from "@/app/portal/accounting/_lib/report-shell/ReportShell";
import ReportTable, { ReportRow, fmtDate } from "@/app/portal/accounting/_lib/report-shell/ReportTable";
import { onReportDate } from "@/app/portal/accounting/_lib/report-shell/reportDate";
import DateInput from "@/components/DateInput";
import type { SalesDimension } from "./SalesSummaryReport";

const DIM_LABEL: Record<SalesDimension, string> = { customer: "Customer", salesman: "Salesman", product: "Product", category: "Category" };
const fmt = (n: number) => (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const unwrap = (r: any) => { let o = r; while (o && typeof o === "object" && o.success !== undefined && o.data !== undefined) o = o.data; return o; };

type Line = { date: string; docNo: string; itemCode: string; description: string; qty: number; sales: number; cost: number; profit: number };
type Group = { code: string; name: string; lines: Line[]; subtotal: { sales: number; cost: number; profit: number } };

export default function DetailedSalesReport({ dimension }: { dimension: SalesDimension }) {
  const { request } = useAccountingApi();
  const label = DIM_LABEL[dimension];
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [codeFrom, setCodeFrom] = useState("");
  const [codeTo, setCodeTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<{ groups: Group[]; totals: any } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ dimension });
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      if (codeFrom) qs.set("codeFrom", codeFrom);
      if (codeTo) qs.set("codeTo", codeTo);
      setData(unwrap(await request(`/sales-reports/detailed?${qs.toString()}`)));
    } catch (e: any) {
      toast.error(e?.message || "Failed to load the detailed analysis");
    } finally {
      setLoading(false);
    }
  }, [request, dimension, from, to, codeFrom, codeTo]);

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const columns = useMemo(() => [
    { key: "date", label: "Date", align: "left" as const, width: 95 },
    { key: "doc", label: "Doc No.", align: "left" as const, width: 130 },
    { key: "item", label: "Item", align: "left" as const, width: 120 },
    { key: "desc", label: "Description", align: "left" as const },
    { key: "qty", label: "Qty", align: "right" as const, width: 70 },
    { key: "sales", label: "Sales", align: "right" as const, width: 120 },
    { key: "cost", label: "Cost", align: "right" as const, width: 120 },
    { key: "profit", label: "Nett Profit", align: "right" as const, width: 120 },
  ], []);

  const rows = useMemo<ReportRow[]>(() => {
    if (!data) return [];
    const out: ReportRow[] = [];
    for (const g of data.groups) {
      out.push({ kind: "group", key: `g-${g.code}`, cells: [`${g.code || "—"}${g.name ? ` — ${g.name}` : ""}`, "", "", "", "", "", "", ""] });
      g.lines.forEach((l, i) => out.push({ kind: "row", key: `g-${g.code}-${i}`, cells: [fmtDate(l.date), l.docNo, l.itemCode, l.description, String(l.qty), fmt(l.sales), fmt(l.cost), fmt(l.profit)] }));
      out.push({ kind: "subtotal", key: `s-${g.code}`, cells: ["", "", "", "Sub-total", "", fmt(g.subtotal.sales), fmt(g.subtotal.cost), fmt(g.subtotal.profit)] });
    }
    const t = data.totals || {};
    out.push({ kind: "total", key: "__total", cells: ["", "", "", "TOTAL", "", fmt(t.sales), fmt(t.cost), fmt(t.profit)] });
    return out;
  }, [data]);

  const exportCsv = () => {
    if (!data) return;
    const lines: (string | number)[][] = [["Group", "Date", "Doc No.", "Item", "Description", "Qty", "Sales", "Cost", "Nett Profit"]];
    for (const g of data.groups) {
      for (const l of g.lines) lines.push([`${g.code} ${g.name}`, l.date, l.docNo, l.itemCode, l.description, l.qty, fmt(l.sales), fmt(l.cost), fmt(l.profit)]);
      lines.push([`${g.code} ${g.name}`, "", "", "", "Sub-total", "", fmt(g.subtotal.sales), fmt(g.subtotal.cost), fmt(g.subtotal.profit)]);
    }
    lines.push(["", "", "", "", "TOTAL", "", fmt(data.totals.sales), fmt(data.totals.cost), fmt(data.totals.profit)]);
    downloadCsv(`Detailed-Sales-By-${label}.csv`, lines);
  };

  return (
    <ReportShell
      title={`Detailed Sales Analysis By ${label}`}
      loading={loading}
      onUpdate={load}
      filters={
        <>
          <Box><Typography variant="caption" sx={{ fontWeight: 700 }}>From Period</Typography><DateInput size="small" value={from} onChange={onReportDate(setFrom)} sx={{ width: 160, mt: 0.25, display: "block" }} /></Box>
          <Box><Typography variant="caption" sx={{ fontWeight: 700 }}>To Period</Typography><DateInput size="small" value={to} onChange={onReportDate(setTo)} sx={{ width: 160, mt: 0.25, display: "block" }} /></Box>
          <Box><Typography variant="caption" sx={{ fontWeight: 700 }}>{`From ${label} code`}</Typography><TextField size="small" value={codeFrom} onChange={(e) => setCodeFrom(e.target.value)} sx={{ width: 130, mt: 0.25, display: "block" }} /></Box>
          <Box><Typography variant="caption" sx={{ fontWeight: 700 }}>{`To ${label} code`}</Typography><TextField size="small" value={codeTo} onChange={(e) => setCodeTo(e.target.value)} sx={{ width: 130, mt: 0.25, display: "block" }} /></Box>
        </>
      }
      headerLines={data ? [`From Date : ${from ? fmtDate(from) : "—"}      To Date : ${to ? fmtDate(to) : "—"}`] : []}
      footerInfo={data ? `${data.groups.length} ${data.groups.length === 1 ? label.toLowerCase() : `${label.toLowerCase()}s`}` : ""}
      onExportCsv={data?.groups.length ? exportCsv : undefined}
    >
      {data ? <ReportTable columns={columns} rows={rows} /> : null}
    </ReportShell>
  );
}
