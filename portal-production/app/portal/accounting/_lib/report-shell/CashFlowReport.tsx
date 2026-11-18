"use client";

// Cash Flow Statement (indirect method) in the standard ReportShell — it was
// the last paper-document report (guru 2026-11-18: "we need to standardise").
// Data: GET /journal/reports/cash-flow?startDate&endDate.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Stack, Typography } from "@mui/material";
import { toast } from "react-toastify";
import { useAccountingApi } from "../api";
import ReportShell from "./ReportShell";
import ReportTable, { ReportRow, fmtDate } from "./ReportTable";
import { DateRangeSelect, monthRange } from "./DateRangeSelect";

type Movement = { code: string; name: string; movement?: number; cashImpact: number };
type CashFlowData = {
  startDate: string;
  endDate: string;
  operating: { netIncome: number; adjustments: Movement[]; total: number };
  investing: { movements: Movement[]; total: number };
  financing: { movements: Movement[]; total: number };
  summary: { beginningCash: number; netChangeInCash: number; endingCash: number; reconciles: boolean; actualEndingCash: number; reconciliationDiff: number };
};

const money2 = (n: number) => (Number(n) || 0).toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function CashFlowReport() {
  const { request } = useAccountingApi();
  const init = monthRange();
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [data, setData] = useState<CashFlowData | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request<CashFlowData>(`/journal/reports/cash-flow?startDate=${from}&endDate=${to}`);
      setData((res as any)?.data ?? res);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load the cash flow statement");
    } finally {
      setLoading(false);
    }
  }, [request, from, to]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const columns = useMemo(
    () => [
      { key: "label", label: "", align: "left" as const },
      { key: "amount", label: "Amount", align: "right" as const, width: 160 },
    ],
    [],
  );

  const rows = useMemo<ReportRow[]>(() => {
    if (!data) return [];
    const out: ReportRow[] = [];
    const section = (key: string, title: string, lines: ReportRow[], subtotalLabel: string, total: number) => {
      out.push({ kind: "group", key: `g-${key}`, cells: [title, null] });
      if (!lines.length) out.push({ kind: "row", key: `${key}-none`, cells: ["(no activity)", 0] });
      out.push(...lines);
      out.push({ kind: "subtotal", key: `t-${key}`, cells: [subtotalLabel, total] });
    };
    section(
      "op",
      "CASH FLOWS FROM OPERATING ACTIVITIES",
      [
        { kind: "row", key: "op-net", cells: ["Net income for the period", data.operating.netIncome] },
        ...data.operating.adjustments.map<ReportRow>((m) => ({ kind: "row", key: `op-${m.code}`, cells: [`${m.code} ${m.name}`, m.cashImpact] })),
      ],
      "Net cash from operating activities",
      data.operating.total,
    );
    section(
      "inv",
      "CASH FLOWS FROM INVESTING ACTIVITIES",
      data.investing.movements.map<ReportRow>((m) => ({ kind: "row", key: `inv-${m.code}`, cells: [`${m.code} ${m.name}`, m.cashImpact] })),
      "Net cash from investing activities",
      data.investing.total,
    );
    section(
      "fin",
      "CASH FLOWS FROM FINANCING ACTIVITIES",
      data.financing.movements.map<ReportRow>((m) => ({ kind: "row", key: `fin-${m.code}`, cells: [`${m.code} ${m.name}`, m.cashImpact] })),
      "Net cash from financing activities",
      data.financing.total,
    );
    out.push({ kind: "total", key: "s-begin", cells: ["Beginning cash & bank", data.summary.beginningCash] });
    out.push({ kind: "total", key: "s-change", cells: ["Net change in cash", data.summary.netChangeInCash] });
    out.push({ kind: "total", key: "s-end", cells: ["Ending cash & bank (computed)", data.summary.beginningCash + data.summary.netChangeInCash] });
    out.push({ kind: "total", key: "s-actual", cells: ["Ending cash & bank (actual from GL)", data.summary.actualEndingCash], highlight: !data.summary.reconciles });
    return out;
  }, [data]);

  return (
    <ReportShell
      title="Cash Flow Statement"
      loading={loading}
      onUpdate={load}
      filters={
        <Stack direction="row" gap={1.5} alignItems="flex-end" flexWrap="wrap">
          <DateRangeSelect label="Period" from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
        </Stack>
      }
      headerLines={data ? [`For the period ${fmtDate(from)} to ${fmtDate(to)}`, "Indirect method, from posted journals"] : []}
      footerInfo={data ? (data.summary.reconciles ? "Reconciles with the bank balances in the GL" : `Reconciliation difference ${money2(data.summary.reconciliationDiff)}`) : ""}
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
