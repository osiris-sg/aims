"use client";

// Xero-parity General Ledger reports.
// - GLDetailReport: every posted line in the period, grouped per account with
//   running balance, per-account Total + Net movement rows.
//   Data: GET /journal/reports/gl-detail
// - GLSummaryReport: one row per active account — Debit / Credit / Net
//   Movement / Account Type + balanced Total.
//   Data: GET /journal/reports/account-activity

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Typography } from "@mui/material";
import { toast } from "react-toastify";
import { useAccountingApi } from "../api";
import ReportShell, { downloadCsv } from "./ReportShell";
import ReportTable, { ReportRow, fmtDate } from "./ReportTable";
import { DateRangeSelect } from "./DateRangeSelect";
import AccountsSelect, { CoaOption } from "./AccountsSelect";
import { GroupingSelect, GroupingValue, GroupField, FlatColumn, buildGroupedRows } from "./Grouping";

const monthRange = () => {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const iso = (d: Date) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
};

function useChartOfAccounts() {
  const { request } = useAccountingApi();
  const [accounts, setAccounts] = useState<CoaOption[]>([]);
  useEffect(() => {
    (async () => {
      try {
        const list = await request<any[]>("/accounting/accounts");
        setAccounts((list || []).map((a: any) => ({ id: a.id, code: a.code, name: a.name, accountType: a.accountType })));
      } catch { /* picker just stays empty */ }
    })();
  }, [request]);
  return accounts;
}

// ---------------------------------------------------------------------
// Also powers "Account Transactions" and the legacy "Expense Listing"
// (same Xero report with a different title / preselected account types).
export function GLDetailReport({
  basePath, title = "General Ledger Detail", presetAccountTypes,
}: {
  basePath: string;
  title?: string;
  presetAccountTypes?: string[];
}) {
  const { request } = useAccountingApi();
  const accounts = useChartOfAccounts();
  const init = monthRange();
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const [presetApplied, setPresetApplied] = useState(!presetAccountTypes?.length);

  // Apply the account-type preset once the chart of accounts arrives, then
  // refetch scoped to those accounts.
  useEffect(() => {
    if (presetApplied || !presetAccountTypes?.length || !accounts.length) return;
    const ids = accounts.filter((a) => presetAccountTypes.includes(a.accountType || "")).map((a) => a.id);
    setAccountIds(ids);
    setPresetApplied(true);
  }, [accounts, presetApplied, presetAccountTypes]);
  const [grouping, setGrouping] = useState<GroupingValue>({ mode: "group", fieldKey: "account" });
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [compact, setCompact] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const acc = accountIds.length ? `&accountIds=${accountIds.join(",")}` : "";
      const res = await request<any>(`/journal/reports/gl-detail?startDate=${from}&endDate=${to}${acc}`);
      setData(res?.data ?? res);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load report");
    } finally {
      setLoading(false);
    }
  }, [request, from, to, accountIds]);

  useEffect(() => { load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refetch once an account-type preset has been applied.
  useEffect(() => {
    if (presetApplied && presetAccountTypes?.length) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetApplied]);

  const groupFields = useMemo<GroupField[]>(() => [
    { key: "account", label: "Account" },
    { key: "source", label: "Source" },
    { key: "date", label: "Date", kind: "date" },
    { key: "reference", label: "Reference" },
  ], []);

  // Flat rows for the grouping engine (running balance only makes sense in
  // the default per-account view, so it's excluded from engine columns).
  const flat = useMemo(() => {
    if (!data) return [];
    const rows: any[] = [];
    for (const g of data.groups || []) {
      g.rows.forEach((r: any, i: number) =>
        rows.push({ ...r, account: `${g.code} — ${g.name}`, __key: `${g.accountId}-${i}` }),
      );
    }
    return rows;
  }, [data]);

  const isAccountGroupView = grouping.mode === "group" && grouping.fieldKey === "account";

  const accountViewColumns = useMemo(() => [
    { key: "date", label: "Date", align: "left" as const, width: 105 },
    { key: "source", label: "Source", align: "left" as const, width: 130 },
    { key: "description", label: "Description", align: "left" as const },
    { key: "reference", label: "Reference", align: "left" as const, width: 160 },
    { key: "debit", label: "Debit", align: "right" as const, width: 110 },
    { key: "credit", label: "Credit", align: "right" as const, width: 110 },
    { key: "running", label: "Running Balance", align: "right" as const, width: 130 },
  ], []);

  const engineColumns = useMemo<FlatColumn[]>(() => [
    { key: "account", label: "Account", align: "left" },
    { key: "date", label: "Date", align: "left", width: 105, kind: "date" },
    { key: "source", label: "Source", align: "left", width: 130 },
    { key: "description", label: "Description", align: "left" },
    { key: "reference", label: "Reference", align: "left", width: 160 },
    { key: "debit", label: "Debit", align: "right", width: 110, kind: "number", aggregate: true },
    { key: "credit", label: "Credit", align: "right", width: 110, kind: "number", aggregate: true },
  ], []);

  const engine = useMemo(
    () => (isAccountGroupView ? null : buildGroupedRows(flat, engineColumns, grouping, groupFields)),
    [isAccountGroupView, flat, engineColumns, grouping, groupFields],
  );

  const columns = useMemo(() => (isAccountGroupView ? accountViewColumns : engine?.columns ?? []),
    [isAccountGroupView, accountViewColumns, engine]);

  const rows = useMemo<ReportRow[]>(() => {
    if (!data) return [];
    if (!isAccountGroupView) return engine?.rows ?? [];
    // Default Xero view: per-account groups with running balance + Net movement.
    const out: ReportRow[] = [];
    for (const g of data.groups || []) {
      out.push({ kind: "group", key: `g-${g.accountId}`, cells: [`${g.code} — ${g.name}`] });
      g.rows.forEach((r: any, i: number) => {
        out.push({
          kind: "row", key: `${g.accountId}-${i}`,
          cells: [fmtDate(r.date), r.source, r.description, r.reference, r.debit, r.credit, r.runningBalance],
        });
      });
      out.push({ kind: "subtotal", key: `t-${g.accountId}`, cells: [`Total ${g.name}`, "", "", "", g.totalDebit, g.totalCredit, g.netMovement] });
      out.push({ kind: "subtotal", key: `n-${g.accountId}`, cells: ["Net movement", "", "", "", "", "", g.netMovement] });
    }
    out.push({ kind: "total", key: "__total", cells: ["Total", "", "", "", data.totals?.debit ?? 0, data.totals?.credit ?? 0, ""] });
    return out;
  }, [data, isAccountGroupView, engine]);

  const exportCsv = () => {
    if (!data) return;
    downloadCsv(
      `${title.replace(/\s+/g, "-")}-${from}-${to}.csv`,
      [columns.map((c) => c.label), ...rows.map((r) => r.cells.map((c) => (typeof c === "number" ? c.toFixed(2) : String((c as any)?.text ?? c ?? ""))))],
    );
  };

  return (
    <ReportShell
      title={title}
      breadcrumb={{ label: "Reports", href: basePath }}
      loading={loading}
      onUpdate={load}
      filters={
        <>
          <AccountsSelect accounts={accounts} selected={accountIds} onChange={setAccountIds} />
          <DateRangeSelect label="Date range" from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
          <GroupingSelect value={grouping} onChange={setGrouping} fields={groupFields} />
        </>
      }
      headerLines={[`For the period ${fmtDate(from)} to ${fmtDate(to)}`]}
      footerInfo={data ? `Showing ${data.lineCount ?? 0} lines across ${(data.groups || []).length} accounts${data.truncated ? " (truncated — narrow the date range)" : ""}` : ""}
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
export function GLSummaryReport({ basePath }: { basePath: string }) {
  const { request } = useAccountingApi();
  const accounts = useChartOfAccounts();
  const init = monthRange();
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const [data, setData] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [compact, setCompact] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request<any>(`/journal/reports/account-activity?startDate=${from}&endDate=${to}`);
      setData(Array.isArray(res) ? res : res?.data ?? []);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load report");
    } finally {
      setLoading(false);
    }
  }, [request, from, to]);

  useEffect(() => { load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    const rows = accountIds.length ? data.filter((r) => accountIds.includes(r.id)) : data;
    return [...rows].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }, [data, accountIds]);

  const columns = useMemo(() => [
    { key: "name", label: "Account", align: "left" as const },
    { key: "code", label: "Account Code", align: "left" as const, width: 120 },
    { key: "debit", label: "Debit", align: "right" as const, width: 130 },
    { key: "credit", label: "Credit", align: "right" as const, width: 130 },
    { key: "net", label: "Net Movement", align: "right" as const, width: 130 },
    { key: "type", label: "Account Type", align: "left" as const, width: 150 },
  ], []);

  const rows = useMemo<ReportRow[]>(() => {
    const out: ReportRow[] = filtered.map((r) => ({
      kind: "row" as const,
      key: r.id,
      cells: [r.name, r.code, r.debit, r.credit, Math.round((r.debit - r.credit) * 100) / 100, r.accountType],
    }));
    const td = filtered.reduce((s, r) => s + r.debit, 0);
    const tc = filtered.reduce((s, r) => s + r.credit, 0);
    out.push({ kind: "total", key: "__total", cells: ["Total", "", Math.round(td * 100) / 100, Math.round(tc * 100) / 100, Math.round((td - tc) * 100) / 100, ""] });
    return out;
  }, [filtered]);

  const exportCsv = () => {
    downloadCsv(
      `General-Ledger-Summary-${from}-${to}.csv`,
      [columns.map((c) => c.label), ...rows.map((r) => r.cells.map((c) => (typeof c === "number" ? c.toFixed(2) : String(c ?? ""))))],
    );
  };

  return (
    <ReportShell
      title="General Ledger Summary"
      breadcrumb={{ label: "Reports", href: basePath }}
      loading={loading}
      onUpdate={load}
      filters={
        <>
          <AccountsSelect accounts={accounts} selected={accountIds} onChange={setAccountIds} />
          <DateRangeSelect label="Date range" from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
        </>
      }
      headerLines={[`For the period ${fmtDate(from)} to ${fmtDate(to)}`]}
      footerInfo={data ? `Showing ${filtered.length} accounts` : ""}
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
