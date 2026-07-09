"use client";

// Xero-parity Aged Receivables/Payables — Summary and Detail variants.
// Data: GET /statements/aged?side=&asOf=&periods=&periodDays=&ageingBy=&level=

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Typography } from "@mui/material";
import { toast } from "react-toastify";
import { useAccountingApi } from "../api";
import ReportShell, { downloadCsv } from "./ReportShell";
import ReportTable, { ReportRow, fmtDate } from "./ReportTable";
import { AsAtDateSelect, FilterSelect } from "./DateRangeSelect";
import { GroupingSelect, GroupingValue, GroupField, FlatColumn, buildGroupedRows } from "./Grouping";

const isoToday = () => {
  const d = new Date(); // default: end of this month, like Xero
  const e = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${e.getFullYear()}-${p(e.getMonth() + 1)}-${p(e.getDate())}`;
};

const PERIOD_OPTIONS = [
  { value: "4:30", label: "4 periods of 1 month" },
  { value: "3:30", label: "3 periods of 1 month" },
  { value: "6:30", label: "6 periods of 1 month" },
  { value: "4:7", label: "4 periods of 1 week" },
];

export default function AgedReport({
  side, level, basePath,
}: {
  side: "receivable" | "payable";
  level: "summary" | "detail";
  basePath: string; // e.g. /portal/accounting/receivables
}) {
  const { request } = useAccountingApi();
  const sideName = side === "receivable" ? "Receivables" : "Payables";
  const title = `Aged ${sideName} ${level === "summary" ? "Summary" : "Detail"}`;
  const contactLabel = side === "receivable" ? "Contact" : "Supplier";
  const docWord = side === "receivable" ? "Invoice" : "Bill";

  const [asOf, setAsOf] = useState(isoToday());
  const [periodCfg, setPeriodCfg] = useState("4:30");
  const [ageingBy, setAgeingBy] = useState<"dueDate" | "documentDate">("dueDate");
  // Detail defaults to Xero's "Group by Contact"; summary defaults to None.
  const [grouping, setGrouping] = useState<GroupingValue>(
    level === "detail" ? { mode: "group", fieldKey: "contact" } : { mode: "group", fieldKey: "" },
  );
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [compact, setCompact] = useState(true);
  const [orgName, setOrgName] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [periods, periodDays] = periodCfg.split(":").map(Number);
      const res = await request<any>(
        `/statements/aged?side=${side}&asOf=${asOf}&periods=${periods}&periodDays=${periodDays}&ageingBy=${ageingBy}&level=${level}`,
      );
      setData(res?.data ?? res);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load report");
    } finally {
      setLoading(false);
    }
  }, [request, side, asOf, periodCfg, ageingBy, level]);

  useEffect(() => { load(); /* initial */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, side]);

  useEffect(() => {
    try {
      const org = JSON.parse(sessionStorage.getItem("aims-current-org-name") || '""');
      if (org) setOrgName(org);
    } catch { /* cosmetic only */ }
  }, []);

  // Detail level: flatten to one row per document so the grouping engine can
  // pivot on any field (contact / dates / reference), Xero-style.
  const flat = useMemo(() => {
    if (!data || level !== "detail") return [];
    const rows: any[] = [];
    for (const g of data.groups || []) {
      for (const d of g.docs) {
        const row: any = {
          __key: d.id, contact: g.contactName, date: d.date, dueDate: d.dueDate,
          number: d.number, reference: d.reference, total: d.total,
          currency: d.currency || "", foreignTotal: d.foreignTotal,
        };
        d.buckets.forEach((v: number, i: number) => (row[`b${i}`] = v));
        rows.push(row);
      }
    }
    return rows;
  }, [data, level]);

  const detailAllColumns = useMemo<FlatColumn[]>(() => {
    const buckets: FlatColumn[] = (data?.bucketLabels || []).map((b: string, i: number) => ({
      key: `b${i}`, label: b, align: "right" as const, kind: "number" as const, aggregate: true,
    }));
    return [
      { key: "contact", label: contactLabel, align: "left" },
      { key: "date", label: `${docWord} Date`, align: "left", width: 110, kind: "date" },
      { key: "dueDate", label: "Due Date", align: "left", width: 110, kind: "date" },
      { key: "number", label: `${docWord} Number`, align: "left", width: 140 },
      { key: "reference", label: "Reference", align: "left" },
      ...buckets,
      { key: "total", label: "Total", align: "right", kind: "number", aggregate: true },
      { key: "currency", label: "Curr", align: "left", width: 60 },
      { key: "foreignTotal", label: "Foreign Amount", align: "right", width: 120, kind: "number" },
    ];
  }, [data, contactLabel, docWord]);

  const detailGroupFields = useMemo<GroupField[]>(() => [
    { key: "contact", label: contactLabel },
    { key: "dueDate", label: "Due Date", kind: "date" },
    { key: "date", label: `${docWord} Date`, kind: "date" },
    { key: "reference", label: "Reference" },
  ], [contactLabel, docWord]);

  const detail = useMemo(
    () => (level === "detail" ? buildGroupedRows(flat, detailAllColumns, grouping, detailGroupFields) : null),
    [level, flat, detailAllColumns, grouping, detailGroupFields],
  );

  // Summary grouping (Xero offers contact-master fields there; "Total" is the
  // one AIMS can compute — collapses everything into a single group).
  const summaryGroupFields = useMemo<GroupField[]>(() => [{ key: "__all", label: "Total" }], []);
  const summaryFlat = useMemo(() => {
    if (!data || level !== "summary") return [];
    return (data.rows || []).map((r: any) => {
      const row: any = { __key: r.contactId, __all: "Total", contact: r.contactName, total: r.total };
      r.buckets.forEach((v: number, i: number) => (row[`b${i}`] = v));
      return row;
    });
  }, [data, level]);
  const summaryEngineColumns = useMemo<FlatColumn[]>(() => {
    const buckets: FlatColumn[] = (data?.bucketLabels || []).map((b: string, i: number) => ({
      key: `b${i}`, label: b, align: "right" as const, kind: "number" as const, aggregate: true,
    }));
    return [
      { key: "contact", label: contactLabel, align: "left" },
      ...buckets,
      { key: "total", label: "Total", align: "right", kind: "number", aggregate: true },
    ];
  }, [data, contactLabel]);
  const summaryEngine = useMemo(
    () => (level === "summary" && grouping.fieldKey ? buildGroupedRows(summaryFlat, summaryEngineColumns, grouping, summaryGroupFields) : null),
    [level, grouping, summaryFlat, summaryEngineColumns, summaryGroupFields],
  );

  const columns = useMemo(() => {
    if (!data) return [];
    if (level === "detail") return detail?.columns ?? [];
    if (summaryEngine) return summaryEngine.columns;
    const buckets = (data.bucketLabels || []).map((b: string, i: number) => ({ key: `b${i}`, label: b, align: "right" as const }));
    return [
      { key: "contact", label: contactLabel, align: "left" as const },
      ...buckets,
      { key: "total", label: "Total", align: "right" as const },
      { key: "curr", label: "Curr", align: "left" as const, width: 60 },
      { key: "foreignTotal", label: "Foreign Amount", align: "right" as const, width: 120 },
    ];
  }, [data, level, contactLabel, detail, summaryEngine]);

  const rows = useMemo<ReportRow[]>(() => {
    if (!data) return [];
    if (level === "detail") return detail?.rows ?? [];
    if (summaryEngine) return summaryEngine.rows;
    const out: ReportRow[] = [];
    for (const r of data.rows || []) {
      out.push({ kind: "row", key: r.contactId, cells: [r.contactName, ...r.buckets, r.total, r.currency || "-", r.foreignTotal ?? null] });
    }
    out.push({ kind: "total", key: "__total", cells: ["Total", ...(data.totals || []), data.grandTotal, "", ""] });
    const pct = (data.totals || []).map((v: number) => (data.grandTotal ? `${((v / data.grandTotal) * 100).toFixed(2)}%` : "-"));
    out.push({ kind: "percent", key: "__pct", cells: ["Percentage of total", ...pct, "100.00%", "", ""] });
    return out;
  }, [data, level, detail, summaryEngine]);

  const exportCsv = () => {
    if (!data) return;
    const header = columns.map((c) => c.label);
    const body = rows
      .filter((r) => r.kind !== "percent")
      .map((r) => r.cells.map((c) => (typeof c === "object" && c !== null ? (c as any).text : typeof c === "number" ? c.toFixed(2) : (c ?? ""))));
    downloadCsv(`${title.replace(/\s+/g, "-")}-${asOf}.csv`, [header, ...body]);
  };

  return (
    <ReportShell
      title={title}
      breadcrumb={{ label: "Reports", href: basePath }}
      loading={loading}
      onUpdate={load}
      filters={
        <>
          <AsAtDateSelect label="Date" value={asOf} onChange={setAsOf} />
          <FilterSelect label="Ageing Periods" value={periodCfg} onChange={setPeriodCfg} options={PERIOD_OPTIONS} width={200} />
          <FilterSelect
            label="Ageing By" value={ageingBy} onChange={(v) => setAgeingBy(v as any)} width={170}
            options={[{ value: "dueDate", label: "Due Date" }, { value: "documentDate", label: `${docWord} Date` }]}
          />
          <GroupingSelect
            value={grouping}
            onChange={setGrouping}
            fields={level === "detail" ? detailGroupFields : summaryGroupFields}
          />
        </>
      }
      headerLines={[
        ...(orgName ? [orgName] : []),
        `As at ${fmtDate(asOf)}`,
        `Ageing by ${ageingBy === "dueDate" ? "due date" : `${docWord.toLowerCase()} date`}`,
      ]}
      footerInfo={
        data
          ? level === "summary"
            ? `Showing ${data.rows?.length ?? 0} contacts`
            : `Showing ${(data.groups || []).reduce((s: number, g: any) => s + g.docs.length, 0)} ${docWord.toLowerCase()}s across ${(data.groups || []).length} contacts`
          : ""
      }
      onExportCsv={exportCsv}
      compact={compact}
      onCompactChange={setCompact}
    >
      {data ? (
        <ReportTable columns={columns} rows={rows} compact={compact} />
      ) : (
        <Box sx={{ py: 6, textAlign: "center" }}>
          <Typography variant="body2" color="text.secondary">{loading ? "Loading…" : "No data"}</Typography>
        </Box>
      )}
    </ReportShell>
  );
}
