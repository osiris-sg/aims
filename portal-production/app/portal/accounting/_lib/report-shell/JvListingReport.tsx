"use client";

// Journal Voucher Listing (legacy screenshots 75/76 — guru 2026-07-24: Xero
// style, legacy words verbatim): every journal LINE for a period, split into
// the red "Unconfirmed Journal Voucher(s)" section (DRAFT) and "Confirmed
// Journal Voucher(s)" (POSTED). Columns: J/V No. | Date. | Accn |
// Description (with the "Rate: x.xxxxxx SGD n" note on foreign lines) |
// Foreign Amount | Curr | Amount. From/To Period defaults 01/01/2018 → today
// like the legacy dialog. Print/CSV from the shell footer.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Typography } from "@mui/material";
import { toast } from "react-toastify";
import { useAccountingApi } from "../api";
import ReportShell, { downloadCsv } from "./ReportShell";
import ReportTable, { ReportRow, fmtDate } from "./ReportTable";
import { DateRangeSelect } from "./DateRangeSelect";

const R = (n: number) => Math.round(n * 100) / 100;
const todayISO = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

type JvLine = {
  jvNo: string;
  date: string;
  accn: string;
  description: string;
  foreignAmount: number | null;
  curr: string;
  amount: number; // signed base (debit − credit)
};

export default function JvListingReport() {
  const { request } = useAccountingApi();

  // Legacy dialog defaults: From Period 01/01/2018, To Period today.
  const [from, setFrom] = useState("2018-01-01");
  const [to, setTo] = useState(todayISO());
  const [loading, setLoading] = useState(false);
  const [sections, setSections] = useState<{ unconfirmed: JvLine[]; confirmed: JvLine[] } | null>(null);
  const [truncated, setTruncated] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request<any>(
        `/journal/reports/journal?startDate=${from}&endDate=${to}&orderBy=journalNumber&includeUnposted=true`,
      );
      const data = (res as any)?.data ?? res;
      const unconfirmed: JvLine[] = [];
      const confirmed: JvLine[] = [];
      for (const j of data?.journals || []) {
        // Unconfirmed = draft JVs AND posted journals born from unconfirmed
        // documents (guru 2026-07-24 status model).
        const bucket = (j.status || "POSTED") === "DRAFT" || j.isUnconfirmed ? unconfirmed : confirmed;
        for (const l of j.lines || []) {
          const amount = R((Number(l.debit) || 0) - (Number(l.credit) || 0));
          const isForeign = l.foreignAmount != null && j.currency && j.currency !== "SGD";
          const sign = amount < 0 ? -1 : 1;
          bucket.push({
            jvNo: j.journalNumber,
            date: j.entryDate,
            accn: l.accountCode || "",
            description:
              (l.description || j.description || "") +
              (isForeign && l.exchangeRate ? `  ·  Rate: ${Number(l.exchangeRate).toFixed(6)}  SGD ${Math.abs(amount).toFixed(2)}` : ""),
            foreignAmount: isForeign ? R(sign * Math.abs(Number(l.foreignAmount))) : null,
            curr: isForeign ? String(j.currency).toUpperCase() : "SGD",
            amount,
          });
        }
      }
      setSections({ unconfirmed, confirmed });
      setTruncated(Boolean(data?.truncated));
      if (data?.truncated) toast.warn("More than 500 journals in the period — narrow the dates to see the rest");
    } catch (e: any) {
      toast.error(e?.message || "Failed to load the journal voucher listing");
    } finally {
      setLoading(false);
    }
  }, [request, from, to]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Columns word-for-word from the legacy sheet.
  const columns = useMemo(
    () => [
      { key: "jv", label: "J/V No.", align: "left" as const, width: 130 },
      { key: "date", label: "Date.", align: "left" as const, width: 105 },
      { key: "accn", label: "Accn", align: "left" as const, width: 80 },
      { key: "desc", label: "Description / Remarks", align: "left" as const },
      { key: "foreign", label: "Foreign Amount", align: "right" as const, width: 130 },
      { key: "curr", label: "Curr", align: "left" as const, width: 60 },
      { key: "amount", label: "Amount", align: "right" as const, width: 130 },
    ],
    [],
  );

  const rows = useMemo<ReportRow[]>(() => {
    if (!sections) return [];
    const out: ReportRow[] = [];
    const pushSection = (label: string, lines: JvLine[], highlight: boolean) => {
      if (!lines.length) return;
      out.push({ kind: "row", key: `s-${label}`, cells: [{ text: label }, "", "", "", null, "", null], highlight });
      let total = 0;
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        total = R(total + l.amount);
        out.push({
          kind: "row",
          key: `${label}-${i}`,
          cells: [l.jvNo, fmtDate(l.date), l.accn, l.description, l.foreignAmount, l.curr, l.amount],
        });
      }
      out.push({ kind: "subtotal", key: `t-${label}`, cells: ["SUB-TOTAL", "", "", "", null, "", total] });
    };
    pushSection("Unconfirmed Journal Voucher(s)", sections.unconfirmed, true);
    pushSection("Confirmed Journal Voucher(s)", sections.confirmed, false);
    const grand = R([...sections.unconfirmed, ...sections.confirmed].reduce((s, l) => s + l.amount, 0));
    out.push({ kind: "total", key: "__grand", cells: ["GRAND TOTAL", "", "", "", null, "", grand] });
    return out;
  }, [sections]);

  const lineCount = (sections?.unconfirmed.length || 0) + (sections?.confirmed.length || 0);

  const exportCsv = () => {
    if (!sections) return;
    const body = (label: string, lines: JvLine[]) =>
      lines.map((l) => [
        label,
        l.jvNo,
        String(l.date).slice(0, 10),
        l.accn,
        l.description,
        l.foreignAmount != null ? l.foreignAmount.toFixed(2) : "",
        l.curr,
        l.amount.toFixed(2),
      ]);
    downloadCsv(`Journal-Voucher-Listing-${from}-${to}.csv`, [
      ["Section", "J/V No.", "Date", "Accn", "Description", "Foreign Amount", "Curr", "Amount"],
      ...body("Unconfirmed", sections.unconfirmed),
      ...body("Confirmed", sections.confirmed),
    ]);
  };

  return (
    <ReportShell
      title="Journal Voucher Listing"
      loading={loading}
      onUpdate={() => load()}
      filters={<DateRangeSelect label="Period" from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />}
      headerLines={sections ? [`From Date : ${fmtDate(from)}   To Date : ${fmtDate(to)}`] : []}
      footerInfo={sections ? `${lineCount} line${lineCount === 1 ? "" : "s"}${truncated ? " · truncated at 500 journals" : ""}` : ""}
      onExportCsv={sections ? exportCsv : undefined}
    >
      {sections ? (
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
