"use client";

// Xero-parity ledger-side reports:
// - TrialBalanceXero: as-at TB with Compare-with-N-years columns.
//   Data: GET /journal/reports/trial-balance (one call per year)
// - JournalReportXero: posted journals grouped with balanced lines, Order by.
//   Data: GET /journal/reports/journal
// - BankSummaryReport: opening / received / spent / closing per bank account.
//   Data: GET /journal/reports/bank-summary

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Typography } from "@mui/material";
import { toast } from "react-toastify";
import { useAccountingApi } from "../api";
import ReportShell, { downloadCsv } from "./ReportShell";
import ReportTable, { ReportRow, fmtDate } from "./ReportTable";
import { AsAtDateSelect, DateRangeSelect, FilterSelect } from "./DateRangeSelect";
import { GroupingSelect, GroupingValue, GroupField, FlatColumn, buildGroupedRows } from "./Grouping";

const isoEndOfMonth = () => {
  const d = new Date();
  const e = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${e.getFullYear()}-${p(e.getMonth() + 1)}-${p(e.getDate())}`;
};
const monthRange = () => {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const iso = (d: Date) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
};

// ---------------------------------------------------------------------
export function TrialBalanceXero({ basePath }: { basePath: string }) {
  const { request } = useAccountingApi();
  const [asOf, setAsOf] = useState(isoEndOfMonth());
  const [compareYears, setCompareYears] = useState("0");
  const [grouping, setGrouping] = useState<GroupingValue>({ mode: "group", fieldKey: "" });
  const [data, setData] = useState<{ current: any; priors: { label: string; rows: any[] }[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [compact, setCompact] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const years = parseInt(compareYears, 10) || 0;
      const dates: string[] = [asOf];
      for (let i = 1; i <= years; i++) {
        const d = new Date(asOf);
        d.setFullYear(d.getFullYear() - i);
        dates.push(d.toISOString().slice(0, 10));
      }
      const results = await Promise.all(dates.map((d) => request<any>(`/journal/reports/trial-balance?asOfDate=${d}`)));
      const [current, ...priors] = results.map((r: any) => r?.data ?? r);
      setData({
        current,
        priors: priors.map((p: any, i: number) => ({ label: fmtDate(dates[i + 1]), rows: p?.rows ?? [] })),
      });
    } catch (e: any) {
      toast.error(e?.message || "Failed to load report");
    } finally {
      setLoading(false);
    }
  }, [request, asOf, compareYears]);

  useEffect(() => { load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groupFields = useMemo<GroupField[]>(() => [{ key: "accountType", label: "Account Type" }], []);

  const flat = useMemo(() => {
    if (!data?.current?.rows) return [];
    const priorByCode = data.priors.map((p) => new Map(p.rows.map((r: any) => [r.code, r])));
    return data.current.rows.map((r: any) => {
      const row: any = {
        __key: r.code, code: r.code, name: r.name, accountType: r.accountType,
        debit: r.debit, credit: r.credit,
      };
      priorByCode.forEach((m, i) => {
        const pr: any = m.get(r.code);
        row[`y${i}`] = pr ? Math.round((pr.debit - pr.credit) * 100) / 100 : 0;
      });
      return row;
    });
  }, [data]);

  const allColumns = useMemo<FlatColumn[]>(() => {
    const priorCols: FlatColumn[] = (data?.priors || []).map((p, i) => ({
      key: `y${i}`, label: p.label, align: "right" as const, width: 130, kind: "number" as const, aggregate: true,
    }));
    return [
      { key: "code", label: "Account Code", align: "left", width: 110 },
      { key: "name", label: "Account", align: "left" },
      { key: "accountType", label: "Account Type", align: "left", width: 150 },
      { key: "debit", label: "Debit - Year to date", align: "right", width: 140, kind: "number", aggregate: true },
      { key: "credit", label: "Credit - Year to date", align: "right", width: 140, kind: "number", aggregate: true },
      ...priorCols,
    ];
  }, [data]);

  const { columns, rows } = useMemo(
    () => buildGroupedRows(flat, allColumns, grouping, groupFields),
    [flat, allColumns, grouping, groupFields],
  );

  const exportCsv = () => {
    downloadCsv(
      `Trial-Balance-${asOf}.csv`,
      [columns.map((c) => c.label), ...rows.map((r) => r.cells.map((c) => (typeof c === "number" ? c.toFixed(2) : String(c ?? ""))))],
    );
  };

  return (
    <ReportShell
      title="Trial Balance"
      breadcrumb={{ label: "Reports", href: basePath }}
      loading={loading}
      onUpdate={load}
      filters={
        <>
          <AsAtDateSelect label="Date" value={asOf} onChange={setAsOf} />
          <FilterSelect
            label="Compare with" value={compareYears} onChange={setCompareYears} width={180}
            options={[
              { value: "0", label: "None" },
              { value: "1", label: "Compare with 1 year" },
              { value: "2", label: "Compare with 2 years" },
              { value: "3", label: "Compare with 3 years" },
            ]}
          />
          <GroupingSelect value={grouping} onChange={setGrouping} fields={groupFields} />
        </>
      }
      headerLines={[
        `As at ${fmtDate(asOf)}`,
        ...(data?.current && !data.current.isBalanced ? ["⚠ Trial balance is OUT OF BALANCE"] : []),
      ]}
      footerInfo={data ? `Showing ${flat.length} accounts` : ""}
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

// ---------------------------------------------------------------------
export function JournalReportXero({ basePath }: { basePath: string }) {
  const { request } = useAccountingApi();
  const init = monthRange();
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [orderBy, setOrderBy] = useState<"journalNumber" | "entryDate" | "postedAt">("journalNumber");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [compact, setCompact] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request<any>(`/journal/reports/journal?startDate=${from}&endDate=${to}&orderBy=${orderBy}`);
      setData(res?.data ?? res);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load report");
    } finally {
      setLoading(false);
    }
  }, [request, from, to, orderBy]);

  useEffect(() => { load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const columns = useMemo(() => [
    { key: "date", label: "Date", align: "left" as const, width: 105 },
    { key: "code", label: "Account Code", align: "left" as const, width: 110 },
    { key: "account", label: "Account", align: "left" as const },
    { key: "description", label: "Description", align: "left" as const },
    { key: "debit", label: "Debit", align: "right" as const, width: 110 },
    { key: "credit", label: "Credit", align: "right" as const, width: 110 },
    { key: "postedBy", label: "Posted By", align: "left" as const, width: 130 },
  ], []);

  const rows = useMemo<ReportRow[]>(() => {
    if (!data) return [];
    const out: ReportRow[] = [];
    for (const j of data.journals || []) {
      const narration = j.description || j.reference || "";
      out.push({ kind: "group", key: `g-${j.id}`, cells: [`${j.journalNumber}${narration ? ` — ${narration}` : ""}`] });
      j.lines.forEach((l: any, i: number) => {
        out.push({
          kind: "row", key: `${j.id}-${i}`,
          cells: [fmtDate(l.date), l.accountCode, l.account, l.description, l.debit, l.credit, j.postedBy],
        });
      });
      out.push({ kind: "subtotal", key: `t-${j.id}`, cells: ["Total", "", "", "", j.totalDebit, j.totalCredit, ""] });
    }
    out.push({ kind: "total", key: "__total", cells: ["Total", "", "", "", data.totals?.debit ?? 0, data.totals?.credit ?? 0, ""] });
    return out;
  }, [data]);

  const exportCsv = () => {
    downloadCsv(
      `Journal-Report-${from}-${to}.csv`,
      [columns.map((c) => c.label), ...rows.map((r) => r.cells.map((c) => (typeof c === "number" ? c.toFixed(2) : String(c ?? ""))))],
    );
  };

  return (
    <ReportShell
      title="Journal Report"
      breadcrumb={{ label: "Reports", href: basePath }}
      loading={loading}
      onUpdate={load}
      filters={
        <>
          <DateRangeSelect label="Date range" from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
          <FilterSelect
            label="Order by" value={orderBy} onChange={(v) => setOrderBy(v as any)} width={170}
            options={[
              { value: "journalNumber", label: "Journal Number" },
              { value: "entryDate", label: "Date" },
              { value: "postedAt", label: "Posted Date" },
            ]}
          />
        </>
      }
      headerLines={[`For the period ${fmtDate(from)} to ${fmtDate(to)}`]}
      footerInfo={data ? `Showing ${data.journalCount ?? 0} journals${data.truncated ? " (truncated — narrow the date range)" : ""}` : ""}
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

// ---------------------------------------------------------------------
// Legacy "Foreign Bank Listing": foreign-currency bank accounts with base +
// foreign balances as at a date. Data: GET /journal/reports/foreign-banks
export function ForeignBankListingReport({ basePath }: { basePath: string }) {
  const { request } = useAccountingApi();
  const [asOf, setAsOf] = useState(isoEndOfMonth());
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request<any>(`/journal/reports/foreign-banks?asOf=${asOf}`);
      setData(res?.data ?? res);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load report");
    } finally {
      setLoading(false);
    }
  }, [request, asOf]);

  useEffect(() => { load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const columns = useMemo(() => [
    { key: "code", label: "Account Code", align: "left" as const, width: 110 },
    { key: "name", label: "Account", align: "left" as const },
    { key: "curr", label: "Curr", align: "left" as const, width: 70 },
    { key: "foreign", label: "Foreign Balance", align: "right" as const, width: 140 },
    { key: "base", label: "Local Balance", align: "right" as const, width: 140 },
  ], []);

  const rows = useMemo<ReportRow[]>(() => {
    if (!data) return [];
    const out: ReportRow[] = (data.rows || []).map((r: any) => ({
      kind: "row" as const,
      key: r.accountId,
      cells: [r.code, r.name, r.currency || "-", r.foreignBalance, r.baseBalance],
    }));
    const totalBase = (data.rows || []).reduce((s: number, r: any) => s + (r.baseBalance || 0), 0);
    out.push({ kind: "total", key: "__total", cells: ["Total", "", "", "", Math.round(totalBase * 100) / 100] });
    return out;
  }, [data]);

  return (
    <ReportShell
      title="Foreign Bank Listing"
      breadcrumb={{ label: "Reports", href: basePath }}
      loading={loading}
      onUpdate={load}
      filters={<AsAtDateSelect label="Date" value={asOf} onChange={setAsOf} />}
      headerLines={[`As at ${fmtDate(asOf)}`]}
      footerInfo={data ? `Showing ${(data.rows || []).length} foreign bank accounts` : ""}
      onExportCsv={() =>
        downloadCsv(`Foreign-Bank-Listing-${asOf}.csv`, [
          columns.map((c) => c.label),
          ...rows.map((r) => r.cells.map((c) => (typeof c === "number" ? c.toFixed(2) : String(c ?? "")))),
        ])
      }
    >
      {data ? (
        (data.rows || []).length ? (
          <ReportTable columns={columns} rows={rows} />
        ) : (
          <Box sx={{ py: 6, textAlign: "center" }}>
            <Typography variant="body2" color="text.secondary">
              No foreign-currency bank accounts yet. Accounts appear here once they are typed FOREIGN_BANK or receive a foreign-currency posting.
            </Typography>
          </Box>
        )
      ) : (
        <Box sx={{ py: 6, textAlign: "center" }}>
          <Typography variant="body2" color="text.secondary">{loading ? "Loading…" : "No data"}</Typography>
        </Box>
      )}
    </ReportShell>
  );
}

// ---------------------------------------------------------------------
export function BankSummaryReport({ basePath }: { basePath: string }) {
  const { request } = useAccountingApi();
  const init = monthRange();
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [grouping, setGrouping] = useState<GroupingValue>({ mode: "group", fieldKey: "" });
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [compact, setCompact] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request<any>(`/journal/reports/bank-summary?startDate=${from}&endDate=${to}`);
      setData(res?.data ?? res);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load report");
    } finally {
      setLoading(false);
    }
  }, [request, from, to]);

  useEffect(() => { load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groupFields = useMemo<GroupField[]>(() => [{ key: "accountType", label: "Account Type" }], []);

  const flat = useMemo(() => (data?.rows || []).map((r: any) => ({ ...r, __key: r.accountId })), [data]);

  const allColumns = useMemo<FlatColumn[]>(() => [
    { key: "name", label: "Account", align: "left" },
    { key: "accountType", label: "Account Type", align: "left", width: 140 },
    { key: "opening", label: "Opening Balance", align: "right", width: 140, kind: "number", aggregate: true },
    { key: "received", label: "Cash Received", align: "right", width: 130, kind: "number", aggregate: true },
    { key: "spent", label: "Cash Spent", align: "right", width: 130, kind: "number", aggregate: true },
    { key: "closing", label: "Closing Balance", align: "right", width: 140, kind: "number", aggregate: true },
  ], []);

  const { columns, rows } = useMemo(
    () => buildGroupedRows(flat, allColumns, grouping, groupFields),
    [flat, allColumns, grouping, groupFields],
  );

  const exportCsv = () => {
    downloadCsv(
      `Bank-Summary-${from}-${to}.csv`,
      [columns.map((c) => c.label), ...rows.map((r) => r.cells.map((c) => (typeof c === "number" ? c.toFixed(2) : String(c ?? ""))))],
    );
  };

  return (
    <ReportShell
      title="Bank Summary"
      breadcrumb={{ label: "Reports", href: basePath }}
      loading={loading}
      onUpdate={load}
      filters={
        <>
          <DateRangeSelect label="Date range" from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
          <GroupingSelect value={grouping} onChange={setGrouping} fields={groupFields} />
        </>
      }
      headerLines={[`For the period ${fmtDate(from)} to ${fmtDate(to)}`]}
      footerInfo={data ? `Showing ${flat.length} bank accounts` : ""}
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
