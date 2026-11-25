"use client";

// Legacy listings: Quotation Listing, Delivery Order Listing, Invoice Listing,
// Outstanding — Transactions (guru 2026-11-25). Documents of one type over a
// date range, with the period total.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Typography } from "@mui/material";
import { toast } from "react-toastify";
import { useAccountingApi } from "@/app/portal/accounting/_lib/api";
import ReportShell, { downloadCsv } from "@/app/portal/accounting/_lib/report-shell/ReportShell";
import ReportTable, { ReportRow, fmtDate } from "@/app/portal/accounting/_lib/report-shell/ReportTable";
import { onReportDate } from "@/app/portal/accounting/_lib/report-shell/reportDate";
import DateInput from "@/components/DateInput";

export type ListingType = "quotation" | "do" | "invoice" | "outstanding";

const TITLE: Record<ListingType, string> = {
  quotation: "Quotation Listing",
  do: "Delivery Order Listing",
  invoice: "Invoice Listing",
  outstanding: "Outstanding — Transactions",
};

const fmt = (n: number) => (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const unwrap = (r: any) => { let o = r; while (o && typeof o === "object" && o.success !== undefined && o.data !== undefined) o = o.data; return o; };

type Row = { number: string; date: string; customer: string; subject?: string; amount: number; status?: string; paid?: number; balance?: number };

export default function DocumentListingReport({ type }: { type: ListingType }) {
  const { request } = useAccountingApi();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<{ rows: Row[]; total: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ type });
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      setData(unwrap(await request(`/sales-reports/listing?${qs.toString()}`)));
    } catch (e: any) {
      toast.error(e?.message || "Failed to load the listing");
    } finally {
      setLoading(false);
    }
  }, [request, type, from, to]);

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const columns = useMemo(() => {
    const base = [
      { key: "number", label: "No.", align: "left" as const, width: 140 },
      { key: "date", label: "Date", align: "left" as const, width: 100 },
      { key: "customer", label: "Customer", align: "left" as const },
    ];
    if (type === "quotation") return [...base, { key: "subject", label: "Subject", align: "left" as const }, { key: "amount", label: "Amount", align: "right" as const, width: 130 }];
    if (type === "outstanding") return [...base, { key: "amount", label: "Invoice", align: "right" as const, width: 120 }, { key: "paid", label: "Paid", align: "right" as const, width: 120 }, { key: "balance", label: "Balance", align: "right" as const, width: 130 }];
    return [...base, { key: "amount", label: "Amount", align: "right" as const, width: 130 }, { key: "status", label: "Status", align: "left" as const, width: 120 }];
  }, [type]);

  const rows = useMemo<ReportRow[]>(() => {
    if (!data) return [];
    const out: ReportRow[] = data.rows.map((r, i) => {
      const common = [r.number, fmtDate(r.date), r.customer];
      let cells: any[];
      if (type === "quotation") cells = [...common, r.subject || "", fmt(r.amount)];
      else if (type === "outstanding") cells = [...common, fmt(r.amount), fmt(r.paid || 0), fmt(r.balance || 0)];
      else cells = [...common, fmt(r.amount), r.status || ""];
      return { kind: "row", key: `${r.number}-${i}`, cells };
    });
    const totalCells = type === "quotation"
      ? ["TOTAL", "", "", "", fmt(data.total)]
      : type === "outstanding"
        ? ["TOTAL", "", "", "", "", fmt(data.total)]
        : ["TOTAL", "", "", fmt(data.total), ""];
    out.push({ kind: "total", key: "__total", cells: totalCells });
    return out;
  }, [data, type]);

  const exportCsv = () => {
    if (!data) return;
    const head = columns.map((c) => c.label);
    const body = data.rows.map((r) => {
      const common = [r.number, r.date, r.customer];
      if (type === "quotation") return [...common, r.subject || "", fmt(r.amount)];
      if (type === "outstanding") return [...common, fmt(r.amount), fmt(r.paid || 0), fmt(r.balance || 0)];
      return [...common, fmt(r.amount), r.status || ""];
    });
    downloadCsv(`${TITLE[type].replace(/[^a-z0-9]+/gi, "-")}.csv`, [head, ...body]);
  };

  return (
    <ReportShell
      title={TITLE[type]}
      loading={loading}
      onUpdate={load}
      filters={
        <>
          <Box><Typography variant="caption" sx={{ fontWeight: 700 }}>From Period</Typography><DateInput size="small" value={from} onChange={onReportDate(setFrom)} sx={{ width: 160, mt: 0.25, display: "block" }} /></Box>
          <Box><Typography variant="caption" sx={{ fontWeight: 700 }}>To Period</Typography><DateInput size="small" value={to} onChange={onReportDate(setTo)} sx={{ width: 160, mt: 0.25, display: "block" }} /></Box>
        </>
      }
      headerLines={data ? [`From Date : ${from ? fmtDate(from) : "—"}      To Date : ${to ? fmtDate(to) : "—"}`] : []}
      footerInfo={data ? `${data.rows.length} ${data.rows.length === 1 ? "document" : "documents"}` : ""}
      onExportCsv={data?.rows.length ? exportCsv : undefined}
    >
      {data ? <ReportTable columns={columns} rows={rows} /> : null}
    </ReportShell>
  );
}
