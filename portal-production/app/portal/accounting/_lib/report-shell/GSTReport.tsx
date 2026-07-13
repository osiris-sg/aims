"use client";

// GST report — legacy-replica function in the Xero-style report shell.
//   Details: per-document rows for a tax code (Category) — Pre-Tax / % /
//   Estimated (net × rate) / actual Tax; rows where the two disagree get the
//   legacy "maroon" flag (error tint).
//   Summary: the F5 boxes — supplies by category, taxable purchases, output /
//   input tax, net GST payable, MES and period Revenue (from the GL).
// Data: GET /statements/gst-report

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Stack, Tab, Tabs, Typography, alpha } from "@mui/material";
import { toast } from "react-toastify";
import { useAccountingApi } from "../api";
import ReportShell, { downloadCsv } from "./ReportShell";
import ReportTable, { ReportRow, fmtAmount, fmtDate } from "./ReportTable";
import { DateRangeSelect, FilterSelect } from "./DateRangeSelect";

const quarterRange = () => {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const iso = (d: Date) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const qStartMonth = Math.floor(now.getMonth() / 3) * 3;
  return {
    from: iso(new Date(now.getFullYear(), qStartMonth, 1)),
    to: iso(new Date(now.getFullYear(), qStartMonth + 3, 0)),
  };
};

const longDate = (v: string) =>
  new Date(v).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

export default function GSTReport({ basePath }: { basePath: string }) {
  const { request } = useAccountingApi();
  const init = quarterRange();
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [category, setCategory] = useState("ALL");
  const [view, setView] = useState<"details" | "summary">("details");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [compact, setCompact] = useState(true);

  const load = useCallback(async (cat?: string) => {
    setLoading(true);
    try {
      const c = cat ?? category;
      const res = await request<any>(`/statements/gst-report?from=${from}&to=${to}&taxCode=${encodeURIComponent(c)}`);
      setData(res?.data ?? res);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load GST report");
    } finally {
      setLoading(false);
    }
  }, [request, from, to, category]);

  useEffect(() => { load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const codeOptions = useMemo(() => {
    const codes = (data?.codes || []) as Array<{ code: string; name: string; rate: number }>;
    return [
      { value: "ALL", label: "All tax codes" },
      ...codes.map((c) => ({ value: c.code, label: `${c.code} — ${c.name} (${c.rate}%)` })),
    ];
  }, [data]);

  // ---- Details table ----
  const detailColumns = [
    { key: "document", label: "Document", align: "left" as const, width: 170 },
    { key: "type", label: "Type", align: "left" as const, width: 60 },
    { key: "date", label: "Date", align: "left" as const, width: 100 },
    { key: "remarks", label: "Remarks", align: "left" as const },
    { key: "preTax", label: "Pre-Tax Amount", align: "right" as const, width: 120 },
    { key: "rate", label: "%", align: "right" as const, width: 60 },
    { key: "estimated", label: "Estimated Amount", align: "right" as const, width: 130 },
    { key: "tax", label: "Tax Amount", align: "right" as const, width: 110 },
    { key: "code", label: "Code", align: "left" as const, width: 55 },
  ];
  const detailRows = useMemo<ReportRow[]>(() => {
    const rows: ReportRow[] = (data?.rows || []).map((r: any, i: number) => ({
      kind: "row" as const,
      key: `${r.docId}-${i}`,
      highlight: !!r.mismatch,
      cells: [r.document, r.type, fmtDate(r.date), r.remarks, r.preTax, r.rate.toFixed(2), r.estimated, r.tax, r.code],
    }));
    if (data?.rows?.length) {
      rows.push({
        kind: "total",
        key: "__total",
        cells: ["TOTAL", null, null, null, data.totals.preTax, null, data.totals.estimated, data.totals.tax, null],
      });
    }
    return rows;
  }, [data]);

  const mismatchCount = useMemo(() => (data?.rows || []).filter((r: any) => r.mismatch).length, [data]);

  // ---- Summary (F5 boxes) ----
  const summaryLines: Array<{ label: string; value: number | null; strong?: boolean; gap?: boolean }> = data
    ? [
        { label: "Total Value of Standard-Rated Supplies made", value: data.summary.stdSupplies },
        { label: "Total Value of Zero-Rated Supplies made", value: data.summary.zeroSupplies },
        { label: "Total Value of Exempted Supplies made", value: data.summary.exemptSupplies },
        { label: "Total Value of Supplies made", value: data.summary.totalSupplies, strong: true },
        { label: "Total Value of Taxable Purchases made", value: data.summary.taxablePurchases, gap: true },
        { label: "Output Tax Due", value: data.summary.outputTax, gap: true },
        { label: "Input Tax Claimed", value: data.summary.inputTax },
        { label: "Nett GST Payable", value: data.summary.nettPayable, strong: true },
        { label: "Major Exporter Scheme", value: data.summary.mes, gap: true },
        { label: "Revenue", value: data.summary.revenue, gap: true },
      ]
    : [];

  const exportCsv = () => {
    if (!data) return;
    if (view === "summary") {
      downloadCsv(`GST-Summary-${from}-${to}.csv`, [
        ["GST Registration Number", data.gstRegNo || ""],
        ["Period", `${from} to ${to}`],
        ...summaryLines.map((l) => [l.label, (l.value ?? 0).toFixed(2)]),
      ]);
      return;
    }
    downloadCsv(`GST-Details-${from}-${to}.csv`, [
      detailColumns.map((c) => c.label),
      ...(data.rows || []).map((r: any) => [
        r.document, r.type, fmtDate(r.date), r.remarks,
        r.preTax.toFixed(2), r.rate.toFixed(2), r.estimated.toFixed(2), r.tax.toFixed(2), r.code,
      ]),
      ["TOTAL", "", "", "", data.totals.preTax.toFixed(2), "", data.totals.estimated.toFixed(2), data.totals.tax.toFixed(2), ""],
    ]);
  };

  const headerLines = [
    ...(data?.gstRegNo ? [`GST Registration Number: ${data.gstRegNo}`] : []),
    `For the period ${longDate(from)} to ${longDate(to)}`,
  ];

  return (
    <ReportShell
      title="Goods and Services Tax"
      breadcrumb={{ label: "Reports", href: basePath }}
      loading={loading}
      onUpdate={() => load()}
      filters={
        <>
          <DateRangeSelect label="Date range" from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
          <FilterSelect
            label="Category" value={category} width={260}
            onChange={(v) => { setCategory(v); load(v); }}
            options={codeOptions}
          />
        </>
      }
      headerLines={headerLines}
      footerInfo={
        data
          ? view === "details"
            ? `Showing ${data.rows?.length ?? 0} documents${mismatchCount ? ` — ${mismatchCount} flagged (estimated ≠ actual tax)` : ""}`
            : "F5 summary — all tax codes for the period"
          : ""
      }
      onExportCsv={exportCsv}
      compact={compact}
      onCompactChange={setCompact}
    >
      <Tabs value={view} onChange={(_, v) => setView(v)} sx={{ mb: 2, minHeight: 36, "& .MuiTab-root": { minHeight: 36, py: 0.5 } }}>
        <Tab label="Details" value="details" />
        <Tab label="Summary" value="summary" />
      </Tabs>

      {!data ? (
        <Box sx={{ py: 6, textAlign: "center" }}>
          <Typography variant="body2" color="text.secondary">{loading ? "Loading…" : "No data"}</Typography>
        </Box>
      ) : view === "details" ? (
        <ReportTable columns={detailColumns} rows={detailRows} compact={compact} />
      ) : (
        <Box sx={{ maxWidth: 640 }}>
          {summaryLines.map((l) => (
            <Stack
              key={l.label}
              direction="row"
              justifyContent="space-between"
              alignItems="center"
              sx={{
                py: 1,
                mt: l.gap ? 2 : 0,
                borderBottom: (t) => `1px solid ${t.palette.divider}`,
                ...(l.strong ? { bgcolor: (t: any) => alpha(t.palette.primary.main, 0.04) } : {}),
                px: 1,
              }}
            >
              <Typography variant="body2" sx={{ fontWeight: l.strong ? 700 : 400 }}>{l.label}</Typography>
              <Typography variant="body2" sx={{ fontWeight: l.strong ? 700 : 400, fontVariantNumeric: "tabular-nums" }}>
                {fmtAmount(l.value)}
              </Typography>
            </Stack>
          ))}
        </Box>
      )}
    </ReportShell>
  );
}
