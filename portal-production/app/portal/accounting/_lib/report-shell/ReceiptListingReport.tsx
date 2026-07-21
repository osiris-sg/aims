"use client";

// Receipts Listing (legacy screenshots 58/59 — guru 2026-07-20: Xero style):
// Official Receipts for a period, grouped by deposit-to BANK ACCOUNT with
// Unconfirmed/Confirmed sections, sub-totals, per-bank totals and a grand
// total. Columns follow the legacy printout: Receipt No / Date / Cheque /
// Received From / Amount (base) / Curr / Foreign Amount. Print + CSV from
// the shell footer (covers the legacy Output Destinations box).

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import { useAccountingApi } from "../api";
import ReportShell, { downloadCsv } from "./ReportShell";
import ReportTable, { ReportRow, fmtDate } from "./ReportTable";
import { DateRangeSelect, FilterSelect } from "./DateRangeSelect";

const R = (n: number) => Math.round(n * 100) / 100;

const monthRange = () => {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const iso = (d: Date) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
};

const unwrap = (r: any) => {
  let out = r;
  while (out && typeof out === "object" && out.success !== undefined && out.data !== undefined) out = out.data;
  return out;
};

type Receipt = {
  id: string;
  receiptNumber: string;
  status: string;
  date: string | null;
  chequeNo: string | null;
  customerId: string | null;
  customerName: string | null;
  debitAccountCode: string | null;
  currency: string;
  rate: number;
  receiptAmount: number;
};

export default function ReceiptListingReport() {
  const { request } = useAccountingApi();
  const init = monthRange();

  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [bank, setBank] = useState("all");
  const [receipts, setReceipts] = useState<Receipt[] | null>(null);
  const [accountNames, setAccountNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [listRaw, accRaw] = await Promise.all([request(`/receipts`), request(`/accounting/accounts`)]);
      const list: Receipt[] = (unwrap(listRaw) || []).filter((r: Receipt) => r.customerId); // shells excluded
      setReceipts(list);
      const accs: any[] = unwrap(accRaw) || [];
      setAccountNames(new Map(accs.map((a: any) => [a.code, a.name])));
    } catch (e: any) {
      toast.error(e?.message || "Failed to load receipts");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Period + bank filter (client-side — the receipts list is small).
  const filtered = useMemo(() => {
    if (!receipts) return null;
    return receipts.filter((r) => {
      const d = String(r.date || "").slice(0, 10);
      if (!d || d < from || d > to) return false;
      if (bank !== "all" && r.debitAccountCode !== bank) return false;
      return true;
    });
  }, [receipts, from, to, bank]);

  const bankOptions = useMemo(() => {
    const codes = Array.from(new Set((receipts || []).map((r) => r.debitAccountCode).filter(Boolean))) as string[];
    codes.sort();
    return [
      { value: "all", label: "All bank accounts" },
      ...codes.map((c) => ({ value: c, label: `${c} — ${accountNames.get(c) || ""}`.trim() })),
    ];
  }, [receipts, accountNames]);

  const baseAmount = (r: Receipt) => R((Number(r.receiptAmount) || 0) * (Number(r.rate) || 1));

  const columns = useMemo(
    () => [
      { key: "no", label: "Receipt No.", align: "left" as const, width: 120 },
      { key: "date", label: "Date", align: "left" as const, width: 110 },
      { key: "cheque", label: "Cheque", align: "left" as const, width: 120 },
      { key: "from", label: "Received From", align: "left" as const },
      { key: "amount", label: "Amount", align: "right" as const, width: 130 },
      { key: "curr", label: "Curr", align: "left" as const, width: 70 },
      { key: "foreign", label: "Foreign Amount", align: "right" as const, width: 140 },
    ],
    [],
  );

  const rows = useMemo<ReportRow[]>(() => {
    if (!filtered) return [];
    const out: ReportRow[] = [];
    const byBank = new Map<string, Receipt[]>();
    for (const r of filtered) {
      const code = r.debitAccountCode || "(no bank)";
      byBank.set(code, [...(byBank.get(code) || []), r]);
    }
    let grand = 0;
    for (const code of Array.from(byBank.keys()).sort()) {
      const group = byBank.get(code)!;
      out.push({ kind: "group", key: `g-${code}`, cells: [`${code}${accountNames.get(code) ? ` — ${accountNames.get(code)}` : ""}`] });
      let bankTotal = 0;
      // Legacy sections: Unconfirmed first (red header), then Confirmed.
      const sections: Array<{ label: string; items: Receipt[]; highlight: boolean }> = [
        { label: "Unconfirmed Receipt(s)", items: group.filter((r) => (r.status || "").toLowerCase() !== "confirmed"), highlight: true },
        { label: "Confirmed Receipt(s)", items: group.filter((r) => (r.status || "").toLowerCase() === "confirmed"), highlight: false },
      ];
      for (const sec of sections) {
        if (!sec.items.length) continue;
        out.push({ kind: "row", key: `s-${code}-${sec.label}`, cells: [{ text: sec.label }, "", "", "", null, "", null], highlight: sec.highlight });
        let subTotal = 0;
        for (const r of sec.items.sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")) || a.receiptNumber.localeCompare(b.receiptNumber))) {
          const amt = baseAmount(r);
          subTotal = R(subTotal + amt);
          out.push({
            kind: "row",
            key: r.id,
            cells: [
              r.receiptNumber,
              r.date ? fmtDate(r.date) : "",
              r.chequeNo || "",
              r.customerName || "",
              amt,
              (r.currency || "SGD").toUpperCase(),
              R(Number(r.receiptAmount) || 0),
            ],
          });
        }
        out.push({ kind: "subtotal", key: `st-${code}-${sec.label}`, cells: ["SUB-TOTAL", "", "", "", subTotal, "", null] });
        bankTotal = R(bankTotal + subTotal);
      }
      out.push({ kind: "subtotal", key: `t-${code}`, cells: ["TOTAL", "", "", "", bankTotal, "", null] });
      grand = R(grand + bankTotal);
    }
    out.push({ kind: "total", key: "__grand", cells: ["GRAND TOTAL", "", "", "", grand, "", null] });
    return out;
  }, [filtered, accountNames]);

  const exportCsv = () => {
    if (!filtered) return;
    downloadCsv(`Receipts-Listing-${from}-${to}.csv`, [
      ["Receipt No.", "Date", "Cheque", "Received From", "Bank Account", "Status", "Amount", "Curr", "Foreign Amount"],
      ...filtered.map((r) => [
        r.receiptNumber,
        String(r.date || "").slice(0, 10),
        r.chequeNo || "",
        r.customerName || "",
        r.debitAccountCode || "",
        (r.status || "").toLowerCase() === "confirmed" ? "Confirmed" : "Unconfirmed",
        baseAmount(r).toFixed(2),
        (r.currency || "SGD").toUpperCase(),
        (Number(r.receiptAmount) || 0).toFixed(2),
      ]),
    ]);
  };

  return (
    <ReportShell
      title="Receipts Listing"
      loading={loading}
      onUpdate={() => load()}
      filters={
        <>
          <DateRangeSelect label="Period" from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
          <FilterSelect label="Bank account" value={bank} width={260} onChange={setBank} options={bankOptions} />
        </>
      }
      headerLines={filtered ? [`From ${fmtDate(from)} to ${fmtDate(to)}`] : []}
      footerInfo={filtered ? `${filtered.length} receipt${filtered.length === 1 ? "" : "s"}` : ""}
      onExportCsv={filtered ? exportCsv : undefined}
    >
      {filtered ? (
        <ReportTable columns={columns} rows={rows} />
      ) : null}
    </ReportShell>
  );
}
