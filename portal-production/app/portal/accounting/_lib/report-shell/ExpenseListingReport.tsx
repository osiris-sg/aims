"use client";

// EXPENSES LISTING (legacy report, guru 2026-11-18): ONE prompt, Cut-Of-Period;
// one row per expense / purchase account, a column per month of the current
// fiscal year up to the cut-off month, BALANCE = year to date, TOTAL last.
// Standard ReportShell like every other report (guru 2026-11-18: "we need to
// standardise" — no paper-document pages). Data:
// GET /journal/reports/expense-listing?cutOff=YYYY-MM-DD.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Stack, Typography } from "@mui/material";
import { toast } from "react-toastify";
import { useAccountingApi } from "../api";
import ReportShell from "./ReportShell";
import ReportTable, { ReportRow, fmtDate } from "./ReportTable";
import DateInput from "@/components/DateInput";
import { todayIso } from "@/helpers/orgToday";
import type { ReportExportModel } from "../report-export";

type Month = { key: string; label: string };
type Row = { accountId: string; code: string; name: string; amounts: number[]; balance: number };
type Data = { cutOff: string; fiscalYearStart: string; months: Month[]; rows: Row[]; totals: number[]; grandTotal: number };

const money2 = (n: number) => (Number(n) || 0).toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function ExpenseListingReport() {
  const { request } = useAccountingApi();
  const [cutOff, setCutOff] = useState<string>(todayIso());
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  // Only the LAST answer may land (an earlier cut-off's response was
  // overwriting the final one while a date was being typed).
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!cutOff) return;
    const mine = ++seq.current;
    setLoading(true);
    try {
      const res = await request<Data>(`/journal/reports/expense-listing?cutOff=${cutOff}`);
      if (mine !== seq.current) return;
      setData((res as any)?.data ?? res);
    } catch (e: any) {
      if (mine === seq.current) toast.error(e?.message || "Failed to load the expenses listing");
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [request, cutOff]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const columns = useMemo(
    () => [
      { key: "account", label: "Account", align: "left" as const },
      ...(data?.months || []).map((m) => ({ key: m.key, label: m.label, align: "right" as const, width: 110 })),
      { key: "balance", label: "Balance", align: "right" as const, width: 130 },
    ],
    [data],
  );

  const rows = useMemo<ReportRow[]>(() => {
    if (!data) return [];
    const blank = (n: number) => (n ? n : null);
    const out: ReportRow[] = data.rows.map((r) => ({
      kind: "row",
      key: r.accountId,
      cells: [r.name.toUpperCase(), ...r.amounts.map(blank), r.balance],
    }));
    out.push({ kind: "total", key: "__total", cells: ["TOTAL", ...data.totals.map(blank), data.grandTotal] });
    return out;
  }, [data]);

  // A full year is 14 columns: the PDF goes out landscape.
  const exportModel = (): ReportExportModel | null => {
    if (!data) return null;
    const body = data.rows.map((r) => [r.name.toUpperCase(), ...r.amounts.map((n) => (n ? money2(n) : "")), money2(r.balance)]);
    body.push(["TOTAL", ...data.totals.map((n) => (n ? money2(n) : "")), money2(data.grandTotal)]);
    return {
      title: "Expenses Listing",
      orgName: "",
      metaLines: [`Cut-Of-Period : ${fmtDate(cutOff)}`],
      tables: [{ headers: ["Account", ...data.months.map((m) => m.label), "Balance"], rows: body, boldRows: [body.length - 1] }],
      note: "All figures shown are in local currency (SGD)",
      landscape: data.months.length >= 7,
    };
  };

  return (
    <ReportShell
      title="Expenses Listing"
      loading={loading}
      onUpdate={load}
      filters={
        <Stack direction="row" gap={1.5} alignItems="flex-end" flexWrap="wrap">
          <DateInput size="small" label="Cut-Of-Period" InputLabelProps={{ shrink: true }} value={cutOff} onChange={(e) => setCutOff(e.target.value)} />
        </Stack>
      }
      headerLines={data ? [`Cut-Of-Period : ${fmtDate(cutOff)}`] : []}
      footerInfo={data ? `${data.rows.length} account${data.rows.length === 1 ? "" : "s"}` : ""}
      getExportModel={exportModel}
    >
      {data ? (
        <>
          <ReportTable columns={columns} rows={rows} />
          <Typography variant="caption" sx={{ display: "block", mt: 1.5, color: "text.secondary" }}>
            Note: All figures shown are in local currency (SGD)
          </Typography>
        </>
      ) : null}
    </ReportShell>
  );
}
