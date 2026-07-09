"use client";

// Xero-parity "Income and Expenses by Contact": one row per contact per type
// (Income / Expense), with N month-comparison columns.
// Data: GET /statements/income-expense-by-contact

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Typography } from "@mui/material";
import { toast } from "react-toastify";
import { useAccountingApi } from "../api";
import ReportShell, { downloadCsv } from "./ReportShell";
import ReportTable, { ReportRow } from "./ReportTable";
import { AsAtDateSelect, FilterSelect } from "./DateRangeSelect";
import { GroupingSelect, GroupingValue, GroupField, FlatColumn, buildGroupedRows } from "./Grouping";

const isoEndOfMonth = () => {
  const d = new Date();
  const e = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${e.getFullYear()}-${p(e.getMonth() + 1)}-${p(e.getDate())}`;
};

type Mode = "both" | "income" | "expense";

export default function IncomeExpenseByContactReport({ basePath }: { basePath: string }) {
  const { request } = useAccountingApi();
  const [to, setTo] = useState(isoEndOfMonth());
  const [compareMonths, setCompareMonths] = useState("4");
  const [mode, setMode] = useState<Mode>("both");
  const [grouping, setGrouping] = useState<GroupingValue>({ mode: "group", fieldKey: "" });
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [compact, setCompact] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request<any>(`/statements/income-expense-by-contact?to=${to}&compareMonths=${compareMonths}`);
      setData(res?.data ?? res);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load report");
    } finally {
      setLoading(false);
    }
  }, [request, to, compareMonths]);

  useEffect(() => { load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groupFields = useMemo<GroupField[]>(() => [
    { key: "contactName", label: "Contact" },
    { key: "type", label: "Type" },
  ], []);

  const flat = useMemo(() => {
    if (!data) return [];
    return (data.rows || [])
      .filter((r: any) => (mode === "both" ? true : mode === "income" ? r.type === "Income" : r.type === "Expense"))
      .map((r: any, i: number) => {
        const row: any = { __key: `${r.contactName}-${r.type}-${i}`, contactName: r.contactName, type: r.type };
        r.cells.forEach((v: number, ci: number) => (row[`m${ci}`] = r.type === "Expense" && v ? -v : v));
        return row;
      });
  }, [data, mode]);

  const engineColumns = useMemo<FlatColumn[]>(() => {
    if (!data) return [];
    return [
      { key: "contactName", label: "Contact", align: "left" },
      { key: "type", label: "Type", align: "left", width: 110 },
      ...(data.columns || []).map((c: string, i: number) => ({
        key: `m${i}`, label: c, align: "right" as const, width: 120, kind: "number" as const, aggregate: true,
      })),
    ];
  }, [data]);

  const engine = useMemo(
    () => (grouping.fieldKey ? buildGroupedRows(flat, engineColumns, grouping, groupFields) : null),
    [grouping, flat, engineColumns, groupFields],
  );

  const columns = useMemo(() => (engine ? engine.columns : engineColumns), [engine, engineColumns]);

  const rows = useMemo<ReportRow[]>(() => {
    if (!data) return [];
    if (engine) return engine.rows;
    const out: ReportRow[] = flat.map((r: any) => ({
      kind: "row" as const,
      key: r.__key,
      cells: [r.contactName, r.type, ...(data.columns || []).map((_: string, i: number) => r[`m${i}`])],
    }));
    if (mode !== "expense") out.push({ kind: "total", key: "__ti", cells: ["Total Income", "", ...(data.totals?.income || [])] });
    if (mode !== "income") out.push({ kind: "total", key: "__te", cells: ["Total Expenses", "", ...(data.totals?.expense || []).map((v: number) => (v ? -v : v))] });
    return out;
  }, [data, engine, flat, mode]);

  const exportCsv = () => {
    if (!data) return;
    downloadCsv(
      `Income-and-Expenses-by-Contact-${to}.csv`,
      [columns.map((c) => c.label), ...rows.map((r) => r.cells.map((c) => (typeof c === "number" ? c.toFixed(2) : String(c ?? ""))))],
    );
  };

  return (
    <ReportShell
      title="Income and Expenses by Contact"
      breadcrumb={{ label: "Reports", href: basePath }}
      loading={loading}
      onUpdate={load}
      filters={
        <>
          <AsAtDateSelect label="Period ending" value={to} onChange={setTo} />
          <FilterSelect
            label="Compare with" value={compareMonths} onChange={setCompareMonths} width={190}
            options={[
              { value: "1", label: "This month only" },
              { value: "3", label: "Compare with 2 months" },
              { value: "4", label: "Compare with 3 months" },
              { value: "6", label: "Compare with 5 months" },
              { value: "12", label: "Compare with 11 months" },
            ]}
          />
          <FilterSelect
            label="Format" value={mode} onChange={(v) => setMode(v as Mode)} width={220}
            options={[
              { value: "both", label: "Income and Expenses" },
              { value: "income", label: "Income only" },
              { value: "expense", label: "Expenses only" },
            ]}
          />
          <GroupingSelect value={grouping} onChange={setGrouping} fields={groupFields} />
        </>
      }
      headerLines={data ? [`For the ${data.columns?.length ?? 0} months ending ${to}`] : []}
      footerInfo={data ? `Showing ${rows.length} rows` : ""}
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
