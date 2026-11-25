"use client";

// Journal Voucher Listing (legacy screenshots 75/76 — guru 2026-07-24: Xero
// style, legacy words verbatim): every journal LINE for a period in one list
// (no Unconfirmed / Confirmed split since 2026-11-19: vouchers carry no
// status — a saved voucher is in the GL). Columns: J/V No. | Date. | Accn |
// Description (with the "Rate: x.xxxxxx SGD n" note on foreign lines) |
// Foreign Amount | Curr | Amount. The period opens on the CURRENT MONTH like
// every other listing (2026-11-18); the legacy dialog's 01/01/2018 → today is
// a preset in the range picker. Print/CSV from the shell footer.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { sourceHref } from "../open-source";
import { Stack, Typography } from "@mui/material";
import { toast } from "react-toastify";
import { useAccountingApi } from "../api";
import ReportShell, { downloadCsv } from "./ReportShell";
import ReportTable, { ReportRow, fmtDate } from "./ReportTable";
import { DateRangeSelect, monthRange } from "./DateRangeSelect";

const R = (n: number) => Math.round(n * 100) / 100;
// Debit side = positive signed amounts; credit side = negatives (shown as
// (x) by fmtAmount). Foreign columns are summed per side only where present.
function sideTotals(lines: Array<{ amount: number; foreignAmount: number | null }>) {
  let dr = 0, cr = 0, fDr = 0, fCr = 0, hasF = false;
  for (const l of lines) {
    if (l.amount > 0) dr = R(dr + l.amount); else cr = R(cr + l.amount);
    if (l.foreignAmount != null) {
      hasF = true;
      if (l.foreignAmount > 0) fDr = R(fDr + l.foreignAmount); else fCr = R(fCr + l.foreignAmount);
    }
  }
  return { dr, cr, fDr: hasF ? fDr : null, fCr: hasF ? fCr : null };
}
type JvLine = {
  jvNo: string;
  href: string | null; // the J/V No. opens the voucher (new tab)
  date: string;
  accn: string;
  description: string;
  foreignAmount: number | null;
  curr: string;
  amount: number; // signed base (debit − credit)
};

export default function JvListingReport() {
  const { request } = useAccountingApi();

  // THIS MONTH, like every other listing (guru 2026-11-18). The legacy
  // dialog's 01/01/2018 → today is still one click away in the range picker's
  // presets, but opening the report no longer pulls every journal ever posted.
  const init = monthRange();
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  // J/V = the journals keyed in by hand on the Journal Voucher screen, and
  // ONLY those (guru 2026-11-06: "JV is only for the manual double entries").
  // Journals AIMS posts from documents already list under their own prefixes
  // — SIN / INV / CN / REC / P/V — in the Audit Trail and the document
  // listings, so they never belong here. The server filters by type MANUAL
  // before its 500-journal cap.
  const [loading, setLoading] = useState(false);
  const [lines, setLines] = useState<JvLine[] | null>(null);
  const [truncated, setTruncated] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request<any>(
        `/journal/reports/journal?startDate=${from}&endDate=${to}&orderBy=journalNumber&includeUnposted=true&source=manual`,
      );
      const data = (res as any)?.data ?? res;
      const bucket: JvLine[] = [];
      for (const j of data?.journals || []) {
        // Guard for an older API that ignores ?source=: hand-keyed only.
        if (j.type && String(j.type).toUpperCase() !== "MANUAL") continue;
        for (const l of j.lines || []) {
          const amount = R((Number(l.debit) || 0) - (Number(l.credit) || 0));
          const isForeign = l.foreignAmount != null && j.currency && j.currency !== "SGD";
          const sign = amount < 0 ? -1 : 1;
          bucket.push({
            jvNo: j.journalNumber,
            href: sourceHref({ journalEntryId: j.id, documentId: j.sourceDocumentId, documentType: j.sourceDocumentType, templateId: j.sourceTemplateId }, ""),
            date: j.entryDate,
            accn: l.accountCode || "",
            description:
              (l.description || j.description || "") +
              (isForeign && l.exchangeRate ? `  ·  Rate: ${Number(l.exchangeRate).toFixed(7)}  SGD ${Math.abs(amount).toFixed(2)}` : ""),
            foreignAmount: isForeign ? R(sign * Math.abs(Number(l.foreignAmount))) : null,
            curr: isForeign ? String(j.currency).toUpperCase() : "SGD",
            amount,
          });
        }
      }
      setLines(bucket);
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
    if (!lines) return [];
    const out: ReportRow[] = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      out.push({ kind: "row", key: `l-${i}`, cells: [l.href ? { text: l.jvNo, href: l.href, newTab: true } : l.jvNo, fmtDate(l.date), l.accn, l.description, l.foreignAmount, l.curr, l.amount] });
    }
    // A balanced journal nets to 0 in the single signed Amount column, so a
    // plain sum printed "-" (guru 2026-10-23). Totals are shown per SIDE —
    // debits and credits (which must agree) — the way an accountant reads a
    // voucher listing.
    const grand = sideTotals(lines);
    out.push({ kind: "total", key: "__grand-dr", cells: ["GRAND TOTAL", "", "", "Debits", grand.fDr, "", grand.dr] });
    out.push({ kind: "total", key: "__grand-cr", cells: ["", "", "", "Credits", grand.fCr, "", grand.cr] });
    return out;
  }, [lines]);

  const lineCount = lines?.length || 0;

  const exportCsv = () => {
    if (!lines) return;
    downloadCsv(`Journal-Voucher-Listing-${from}-${to}.csv`, [
      ["J/V No.", "Date", "Accn", "Description", "Foreign Amount", "Curr", "Amount"],
      ...lines.map((l) => [
        l.jvNo,
        String(l.date).slice(0, 10),
        l.accn,
        l.description,
        l.foreignAmount != null ? l.foreignAmount.toFixed(2) : "",
        l.curr,
        l.amount.toFixed(2),
      ]),
    ]);
  };

  return (
    <ReportShell
      title="Journal Voucher Listing"
      loading={loading}
      onUpdate={load}
      filters={
        <Stack direction="row" gap={1.5} alignItems="flex-end" flexWrap="wrap">
          <DateRangeSelect label="Period" from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
        </Stack>
      }
      headerLines={lines ? [`From Date : ${fmtDate(from)}   To Date : ${fmtDate(to)}`] : []}
      footerInfo={lines ? `${lineCount} line${lineCount === 1 ? "" : "s"}${truncated ? " · truncated at 500 journals" : ""}` : ""}
      onExportCsv={lines ? exportCsv : undefined}
    >
      {lines ? (
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
