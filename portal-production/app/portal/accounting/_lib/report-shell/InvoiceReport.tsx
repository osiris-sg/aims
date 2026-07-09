"use client";

// Xero-parity Receivable / Payable Invoice report — Summary (per document)
// and Detail (per line item) with Xero-style Grouping/Summarising.
// Data: GET /statements/invoice-report

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Typography } from "@mui/material";
import { toast } from "react-toastify";
import { useAccountingApi } from "../api";
import ReportShell, { downloadCsv } from "./ReportShell";
import ReportTable from "./ReportTable";
import { DateRangeSelect, FilterSelect } from "./DateRangeSelect";
import { GroupingSelect, GroupingValue, GroupField, FlatColumn, buildGroupedRows } from "./Grouping";

const monthRange = () => {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const iso = (d: Date) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
};

export default function InvoiceReport({
  side, basePath, level = "summary",
}: {
  side: "receivable" | "payable";
  basePath: string;
  level?: "summary" | "detail";
}) {
  const { request } = useAccountingApi();
  const isAR = side === "receivable";
  const docWord = isAR ? "Invoice" : "Bill";
  const title = `${isAR ? "Receivable" : "Payable"} Invoice ${level === "detail" ? "Detail" : "Summary"}`;

  const init = monthRange();
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [dateBasis, setDateBasis] = useState<"documentDate" | "dueDate">("documentDate");
  const [status, setStatus] = useState<"all" | "outstanding" | "paid">("all");
  const [grouping, setGrouping] = useState<GroupingValue>({ mode: "group", fieldKey: "contact" });
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [compact, setCompact] = useState(true);

  const load = useCallback(async (statusOverride?: typeof status) => {
    setLoading(true);
    try {
      const s = statusOverride ?? status;
      const res = await request<any>(
        `/statements/invoice-report?side=${side}&from=${from}&to=${to}&dateBasis=${dateBasis}&status=${s}&level=${level}`,
      );
      setData(res?.data ?? res);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load report");
    } finally {
      setLoading(false);
    }
  }, [request, side, from, to, dateBasis, status, level]);

  useEffect(() => { load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side, level]);

  // Flatten the server's contact groups into one row per document/line so the
  // grouping engine can pivot on any field.
  const flat = useMemo(() => {
    if (!data) return [];
    const rows: any[] = [];
    for (const g of data.groups || []) {
      if (level === "detail") {
        g.lines.forEach((l: any, i: number) => rows.push({ ...l, contact: g.contactName, __key: `${l.docId}-${i}` }));
      } else {
        for (const d of g.docs) rows.push({ ...d, contact: g.contactName, __key: d.id });
      }
    }
    return rows;
  }, [data, level]);

  const allColumns = useMemo<FlatColumn[]>(() => {
    if (level === "detail") {
      return [
        { key: "contact", label: "Contact", align: "left" },
        { key: "date", label: `${docWord} Date`, align: "left", width: 105, kind: "date" },
        { key: "source", label: "Source", align: "left", width: 110 },
        { key: "reference", label: "Reference", align: "left", width: 140 },
        { key: "itemCode", label: "Item Code", align: "left", width: 100 },
        { key: "description", label: "Description", align: "left" },
        { key: "quantity", label: "Quantity", align: "right", width: 80, isCount: true, aggregate: true },
        { key: "unitPrice", label: "Unit Price (ex)", align: "right", width: 110, kind: "number" },
        { key: "tax", label: "Tax", align: "right", width: 90, kind: "number", aggregate: true },
        { key: "gross", label: "Gross", align: "right", width: 100, kind: "number", aggregate: true },
        { key: "invoiceTotal", label: `${docWord} Total`, align: "right", width: 110, kind: "number" },
        { key: "status", label: "Status", align: "left", width: 90 },
      ];
    }
    return [
      { key: "contact", label: "Contact", align: "left" },
      { key: "number", label: `${docWord} Number`, align: "left", width: 150 },
      { key: "date", label: `${docWord} Date`, align: "left", width: 110, kind: "date" },
      { key: "dueDate", label: "Due Date", align: "left", width: 110, kind: "date" },
      { key: "lastPaymentDate", label: "Last Payment Date", align: "left", width: 130, kind: "date" },
      { key: "reference", label: "Reference", align: "left" },
      { key: "gross", label: "Gross", align: "right", width: 110, kind: "number", aggregate: true },
      { key: "paid", label: "Payments / Credits", align: "right", width: 130, kind: "number", aggregate: true },
      { key: "balance", label: "Balance", align: "right", width: 110, kind: "number", aggregate: true },
      { key: "currency", label: "Curr", align: "left", width: 60 },
      { key: "foreignBalance", label: "Foreign Balance", align: "right", width: 120, kind: "number" },
      { key: "source", label: "Source", align: "left", width: 130 },
      { key: "status", label: "Status", align: "left", width: 90 },
    ];
  }, [docWord, level]);

  // Xero's groupable fields, limited to attributes AIMS actually stores.
  const groupFields = useMemo<GroupField[]>(() => {
    if (level === "detail") {
      return [
        { key: "contact", label: "Contact" },
        { key: "date", label: `${docWord} Date`, kind: "date" },
        { key: "reference", label: "Reference" },
        { key: "itemCode", label: "Item Code" },
        { key: "status", label: "Status" },
      ];
    }
    return [
      { key: "contact", label: "Contact" },
      { key: "balance", label: "Balance", kind: "number" },
      { key: "date", label: `${docWord} Date`, kind: "date" },
      { key: "dueDate", label: "Due Date", kind: "date" },
      { key: "gross", label: "Gross", kind: "number" },
      { key: "lastPaymentDate", label: "Last Payment Date", kind: "date" },
      { key: "paid", label: "Payments / Credits", kind: "number" },
      { key: "reference", label: "Reference" },
      { key: "source", label: "Source" },
      { key: "status", label: "Status" },
    ];
  }, [docWord, level]);

  const { columns, rows } = useMemo(
    () => buildGroupedRows(flat, allColumns, grouping, groupFields),
    [flat, allColumns, grouping, groupFields],
  );

  const exportCsv = () => {
    if (!data) return;
    const header = columns.map((c) => c.label);
    const body = rows.map((r) => r.cells.map((c) => (typeof c === "number" ? c.toFixed(2) : (c as any)?.text ?? c ?? "")));
    downloadCsv(`${title.replace(/\s+/g, "-")}-${from}-${to}.csv`, [header, ...body]);
  };

  const setFormat = (s: "all" | "outstanding" | "paid") => {
    setStatus(s);
    load(s);
  };

  return (
    <ReportShell
      title={title}
      breadcrumb={{ label: "Reports", href: basePath }}
      loading={loading}
      onUpdate={() => load()}
      filters={
        <>
          <DateRangeSelect label="Date range" from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
          <FilterSelect
            label="Date Search" value={dateBasis} onChange={(v) => setDateBasis(v as any)} width={170}
            options={[{ value: "documentDate", label: `${docWord} Date` }, { value: "dueDate", label: "Due Date" }]}
          />
          <FilterSelect
            label="Status" value={status} onChange={(v) => setFormat(v as any)} width={200}
            options={[
              { value: "all", label: "Approved, sent and paid" },
              { value: "outstanding", label: "Outstanding" },
              { value: "paid", label: "Paid" },
            ]}
          />
          <GroupingSelect value={grouping} onChange={setGrouping} fields={groupFields} />
        </>
      }
      headerLines={[`For the period ${new Date(from).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} to ${new Date(to).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`]}
      footerInfo={data
        ? level === "detail"
          ? `Showing ${flat.length} lines`
          : `Showing ${flat.length} ${docWord.toLowerCase()}s`
        : ""}
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
