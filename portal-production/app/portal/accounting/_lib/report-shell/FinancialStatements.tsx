"use client";

// Xero-parity financial statements.
// - ProfitLossXero: date range + Compare-with previous periods; sections
//   Trading Income → Cost of Sales → Gross Profit → Operating Expenses →
//   Net Profit, one row per account.
//   Data: GET /journal/reports/account-activity per period.
// - BalanceSheetXero: as-at date + Compare-with; Assets / Liabilities /
//   Equity sections with Current Year Earnings and a balance check.
//   Data: GET /journal/reports/trial-balance per date.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Chip, Typography } from "@mui/material";
import { toast } from "react-toastify";
import { useAccountingApi } from "../api";
import ReportShell, { downloadCsv } from "./ReportShell";
import ReportTable, { ReportRow, fmtDate } from "./ReportTable";
import { AsAtDateSelect, DateRangeSelect, FilterSelect } from "./DateRangeSelect";

const p2 = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const monthRange = () => {
  const now = new Date();
  return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
};
const R = (n: number) => Math.round(n * 100) / 100;
const monthLabel = (d: Date) => d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });

// ---------------------------------------------------------------------
export function ProfitLossXero({ basePath }: { basePath: string }) {
  const { request } = useAccountingApi();
  const init = monthRange();
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [compare, setCompare] = useState("0"); // previous months
  const [periods, setPeriods] = useState<{ label: string; rows: any[] }[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [compact, setCompact] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const n = parseInt(compare, 10) || 0;
      // Current period + N preceding periods of the same month-length.
      const start = new Date(from);
      const windows: { label: string; from: string; to: string }[] = [
        { label: monthLabel(new Date(to)), from, to },
      ];
      for (let i = 1; i <= n; i++) {
        const s = new Date(start.getFullYear(), start.getMonth() - i, 1);
        const e = new Date(start.getFullYear(), start.getMonth() - i + 1, 0);
        windows.push({ label: monthLabel(e), from: iso(s), to: iso(e) });
      }
      const results = await Promise.all(
        windows.map((w) => request<any>(`/journal/reports/account-activity?startDate=${w.from}&endDate=${w.to}`)),
      );
      setPeriods(results.map((r: any, i) => ({ label: windows[i].label, rows: (Array.isArray(r) ? r : r?.data ?? []).filter((a: any) => a.category === "PNL") })));
    } catch (e: any) {
      toast.error(e?.message || "Failed to load report");
    } finally {
      setLoading(false);
    }
  }, [request, from, to, compare]);

  useEffect(() => { load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const columns = useMemo(() => {
    if (!periods) return [];
    return [
      { key: "name", label: "", align: "left" as const },
      ...periods.map((p, i) => ({ key: `p${i}`, label: p.label, align: "right" as const, width: 130 })),
    ];
  }, [periods]);

  const rows = useMemo<ReportRow[]>(() => {
    if (!periods) return [];
    const nCols = periods.length;
    // Union of accounts across periods, keyed by code.
    const SECTIONS: { title: string; types: string[]; sign: 1 | -1 }[] = [
      { title: "Trading Income", types: ["SALES", "INCOME"], sign: 1 },
      { title: "Cost of Sales", types: ["PURCHASE"], sign: 1 },
      { title: "Operating Expenses", types: ["EXPENSE", "EXCHANGE_GAIN_LOSS"], sign: 1 },
    ];
    const byCode = new Map<string, { name: string; accountType: string; vals: number[] }>();
    periods.forEach((p, pi) => {
      for (const a of p.rows) {
        const e = byCode.get(a.code) || { name: a.name, accountType: a.accountType, vals: Array(nCols).fill(0) };
        // Income positive when credit-normal; costs positive when debit-normal.
        e.vals[pi] = R(a.normalBalance === "CREDIT" ? a.credit - a.debit : a.debit - a.credit);
        byCode.set(a.code, e);
      }
    });

    const out: ReportRow[] = [];
    const sectionTotals: number[][] = [];
    for (const sec of SECTIONS) {
      const accs = [...byCode.entries()]
        .filter(([, e]) => sec.types.includes(e.accountType))
        .filter(([, e]) => e.vals.some((v) => Math.abs(v) > 0.005))
        .sort((a, b) => a[1].name.localeCompare(b[1].name));
      const totals = Array(nCols).fill(0);
      out.push({ kind: "group", key: `s-${sec.title}`, cells: [sec.title] });
      for (const [code, e] of accs) {
        e.vals.forEach((v, i) => (totals[i] += v));
        out.push({ kind: "row", key: `a-${code}`, cells: [e.name, ...e.vals] });
      }
      out.push({ kind: "subtotal", key: `t-${sec.title}`, cells: [`Total ${sec.title}`, ...totals.map(R)] });
      sectionTotals.push(totals);

      if (sec.title === "Cost of Sales") {
        const gross = totals.map((_, i) => R(sectionTotals[0][i] - sectionTotals[1][i]));
        out.push({ kind: "total", key: "__gross", cells: ["Gross Profit", ...gross] });
      }
    }
    const net = Array(nCols)
      .fill(0)
      .map((_, i) => R(sectionTotals[0][i] - sectionTotals[1][i] - sectionTotals[2][i]));
    out.push({ kind: "total", key: "__net", cells: ["Net Profit", ...net] });
    return out;
  }, [periods]);

  const exportCsv = () => {
    downloadCsv(
      `Profit-and-Loss-${from}-${to}.csv`,
      [columns.map((c) => c.label || "Account"), ...rows.map((r) => r.cells.map((c) => (typeof c === "number" ? c.toFixed(2) : String(c ?? ""))))],
    );
  };

  return (
    <ReportShell
      title="Profit and Loss"
      breadcrumb={{ label: "Reports", href: basePath }}
      loading={loading}
      onUpdate={load}
      filters={
        <>
          <DateRangeSelect label="Date range" from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
          <FilterSelect
            label="Compare with" value={compare} onChange={setCompare} width={200}
            options={[
              { value: "0", label: "None" },
              { value: "1", label: "Previous month" },
              { value: "3", label: "Previous 3 months" },
              { value: "6", label: "Previous 6 months" },
              { value: "11", label: "Previous 11 months" },
            ]}
          />
        </>
      }
      headerLines={[`For the period ${fmtDate(from)} to ${fmtDate(to)}`]}
      footerInfo={periods ? `Showing ${periods.length} period${periods.length > 1 ? "s" : ""}` : ""}
      onExportCsv={exportCsv}
      compact={compact}
      onCompactChange={setCompact}
    >
      {periods ? (
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
export function BalanceSheetXero({ basePath }: { basePath: string }) {
  const { request } = useAccountingApi();
  const [asOf, setAsOf] = useState(() => {
    const d = new Date();
    return iso(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  });
  const [compare, setCompare] = useState("0"); // previous years
  const [dates, setDates] = useState<{ label: string; rows: any[]; isBalanced?: boolean }[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [compact, setCompact] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const n = parseInt(compare, 10) || 0;
      const ds: string[] = [asOf];
      for (let i = 1; i <= n; i++) {
        const d = new Date(asOf);
        d.setFullYear(d.getFullYear() - i);
        ds.push(iso(d));
      }
      const results = await Promise.all(ds.map((d) => request<any>(`/journal/reports/trial-balance?asOfDate=${d}`)));
      setDates(results.map((r: any, i) => {
        const data = r?.data ?? r;
        return { label: fmtDate(ds[i]), rows: data?.rows ?? [], isBalanced: data?.isBalanced };
      }));
    } catch (e: any) {
      toast.error(e?.message || "Failed to load report");
    } finally {
      setLoading(false);
    }
  }, [request, asOf, compare]);

  useEffect(() => { load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const columns = useMemo(() => {
    if (!dates) return [];
    return [
      { key: "name", label: "", align: "left" as const },
      ...dates.map((d, i) => ({ key: `d${i}`, label: d.label, align: "right" as const, width: 140 })),
    ];
  }, [dates]);

  const rows = useMemo<ReportRow[]>(() => {
    if (!dates) return [];
    const nCols = dates.length;
    const SECTIONS: { title: string; types: string[] }[] = [
      { title: "Fixed Assets", types: ["FIXED_ASSET"] },
      { title: "Current Assets", types: ["CURRENT_ASSET"] },
      { title: "Current Liabilities", types: ["CURRENT_LIABILITY", "TAX_LIABILITY"] },
      { title: "Non-current Liabilities", types: ["LONG_TERM_LIABILITY"] },
      { title: "Equity", types: ["SHARE_CAPITAL", "RETAINED_PROFIT"] },
    ];
    const byCode = new Map<string, { name: string; accountType: string; vals: number[] }>();
    const netProfit = Array(nCols).fill(0);
    dates.forEach((d, di) => {
      for (const a of d.rows) {
        if (a.category === "PNL") {
          netProfit[di] += a.normalBalance === "CREDIT" ? a.credit - a.debit : -(a.debit - a.credit);
          continue;
        }
        const e = byCode.get(a.code) || { name: a.name, accountType: a.accountType, vals: Array(nCols).fill(0) };
        e.vals[di] = R(a.balance); // normal-balance signed
        byCode.set(a.code, e);
      }
    });

    const out: ReportRow[] = [];
    const totalsBySection = new Map<string, number[]>();
    for (const sec of SECTIONS) {
      const accs = [...byCode.entries()]
        .filter(([, e]) => sec.types.includes(e.accountType))
        .filter(([, e]) => e.vals.some((v) => Math.abs(v) > 0.005))
        .sort((a, b) => a[0].localeCompare(b[0]));
      const totals = Array(nCols).fill(0);
      out.push({ kind: "group", key: `s-${sec.title}`, cells: [sec.title] });
      for (const [code, e] of accs) {
        e.vals.forEach((v, i) => (totals[i] += v));
        out.push({ kind: "row", key: `a-${code}`, cells: [e.name, ...e.vals] });
      }
      if (sec.title === "Equity") {
        out.push({ kind: "row", key: "__cye", cells: ["Current Year Earnings", ...netProfit.map(R)] });
        netProfit.forEach((v, i) => (totals[i] += v));
      }
      out.push({ kind: "subtotal", key: `t-${sec.title}`, cells: [`Total ${sec.title}`, ...totals.map(R)] });
      totalsBySection.set(sec.title, totals);

      if (sec.title === "Current Assets") {
        const ta = totals.map((_, i) => R((totalsBySection.get("Fixed Assets")?.[i] ?? 0) + totals[i]));
        out.push({ kind: "total", key: "__ta", cells: ["Total Assets", ...ta] });
        totalsBySection.set("__assets", ta);
      }
      if (sec.title === "Non-current Liabilities") {
        const tl = totals.map((_, i) => R((totalsBySection.get("Current Liabilities")?.[i] ?? 0) + totals[i]));
        out.push({ kind: "total", key: "__tl", cells: ["Total Liabilities", ...tl] });
        totalsBySection.set("__liab", tl);
        const na = tl.map((_, i) => R((totalsBySection.get("__assets")?.[i] ?? 0) - tl[i]));
        out.push({ kind: "total", key: "__na", cells: ["Net Assets", ...na] });
        totalsBySection.set("__net", na);
      }
    }
    return out;
  }, [dates]);

  const balanced = useMemo(() => {
    if (!dates) return true;
    // Net Assets vs Total Equity per column.
    const netRow = rows.find((r) => r.key === "__na");
    const eqRow = rows.find((r) => r.key === "t-Equity");
    if (!netRow || !eqRow) return true;
    for (let i = 1; i < netRow.cells.length; i++) {
      if (Math.abs(Number(netRow.cells[i]) - Number(eqRow.cells[i])) > 0.02) return false;
    }
    return true;
  }, [dates, rows]);

  const exportCsv = () => {
    downloadCsv(
      `Balance-Sheet-${asOf}.csv`,
      [columns.map((c) => c.label || "Account"), ...rows.map((r) => r.cells.map((c) => (typeof c === "number" ? c.toFixed(2) : String(c ?? ""))))],
    );
  };

  return (
    <ReportShell
      title="Balance Sheet"
      breadcrumb={{ label: "Reports", href: basePath }}
      loading={loading}
      onUpdate={load}
      filters={
        <>
          <AsAtDateSelect label="Date" value={asOf} onChange={setAsOf} />
          <FilterSelect
            label="Compare with" value={compare} onChange={setCompare} width={190}
            options={[
              { value: "0", label: "None" },
              { value: "1", label: "Compare with 1 year" },
              { value: "2", label: "Compare with 2 years" },
              { value: "3", label: "Compare with 3 years" },
            ]}
          />
        </>
      }
      headerLines={[`As at ${fmtDate(asOf)}`]}
      cardActions={!balanced ? <Chip size="small" color="error" label="OUT OF BALANCE" /> : undefined}
      footerInfo={dates ? `Showing ${dates.length} date${dates.length > 1 ? "s" : ""}` : ""}
      onExportCsv={exportCsv}
      compact={compact}
      onCompactChange={setCompact}
    >
      {dates ? (
        <ReportTable columns={columns} rows={rows} compact={compact} />
      ) : (
        <Box sx={{ py: 6, textAlign: "center" }}>
          <Typography variant="body2" color="text.secondary">{loading ? "Loading…" : "No data"}</Typography>
        </Box>
      )}
    </ReportShell>
  );
}
