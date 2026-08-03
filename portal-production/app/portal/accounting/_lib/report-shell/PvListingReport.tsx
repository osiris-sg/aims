"use client";

// Payment Voucher Listing (legacy screenshots 88/89 — guru 2026-08-01, same
// treatment as AR's Receipts Listing: Xero-style shell, legacy name/columns
// word-for-word). Bill payments for a period, grouped by paid-from BANK
// ACCOUNT with Unconfirmed/Confirmed sections, SUB-TOTALs, per-bank TOTALs
// and a GRAND TOTAL. Columns: P/V No. / Date. / Payee / Amount / Curr /
// Foreign Amount. Print + CSV from the shell footer (legacy Output
// Destinations box).

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

type Voucher = {
  id: string;
  paymentDate: string;
  amount: number;
  reference: string | null;
  billNumber: string | null;
  supplierName: string | null;
  bankAccount: { code: string; name: string } | null;
  journal: {
    journalNumber: string;
    reference: string | null;
    status: string;
    isUnconfirmed: boolean;
    currency: string;
    foreignAmount: number | null;
  } | null;
};

export default function PvListingReport() {
  const { request } = useAccountingApi();
  const init = monthRange();

  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [bank, setBank] = useState("all");
  const [vouchers, setVouchers] = useState<Voucher[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const raw = await request(`/bills/payments-listing?from=${from}&to=${to}`);
      setVouchers(unwrap(raw) || []);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load payment vouchers");
    } finally {
      setLoading(false);
    }
  }, [request, from, to]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    if (!vouchers) return null;
    return vouchers.filter((v) => (bank === "all" ? true : v.bankAccount?.code === bank));
  }, [vouchers, bank]);

  const bankOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const v of vouchers || []) {
      if (v.bankAccount?.code) seen.set(v.bankAccount.code, v.bankAccount.name || "");
    }
    return [
      { value: "all", label: "All bank accounts" },
      ...Array.from(seen.keys()).sort().map((c) => ({ value: c, label: `${c} — ${seen.get(c) || ""}`.trim() })),
    ];
  }, [vouchers]);

  // The voucher number: the P/V journal reference when present (already
  // prefixed "P/V …"), else the journal number.
  const pvNo = (v: Voucher) =>
    v.journal?.reference || v.journal?.journalNumber || (v.billNumber ? `P/V ${v.billNumber}` : v.reference || "—");
  const isUnconfirmed = (v: Voucher) => !!v.journal?.isUnconfirmed;
  const currency = (v: Voucher) => (v.journal?.currency || "SGD").toUpperCase();
  const foreignAmount = (v: Voucher) =>
    v.journal?.foreignAmount != null ? R(Number(v.journal.foreignAmount)) : R(Number(v.amount) || 0);

  const columns = useMemo(
    () => [
      { key: "no", label: "P/V No.", align: "left" as const, width: 170 },
      { key: "date", label: "Date.", align: "left" as const, width: 110 },
      { key: "payee", label: "Payee", align: "left" as const },
      { key: "amount", label: "Amount", align: "right" as const, width: 130 },
      { key: "curr", label: "Curr", align: "left" as const, width: 70 },
      { key: "foreign", label: "Foreign Amount", align: "right" as const, width: 140 },
    ],
    [],
  );

  const rows = useMemo<ReportRow[]>(() => {
    if (!filtered) return [];
    const out: ReportRow[] = [];
    const byBank = new Map<string, Voucher[]>();
    for (const v of filtered) {
      const code = v.bankAccount?.code || "(no bank)";
      byBank.set(code, [...(byBank.get(code) || []), v]);
    }
    const bankName = (code: string) => filtered.find((v) => v.bankAccount?.code === code)?.bankAccount?.name || "";
    let grand = 0;
    for (const code of Array.from(byBank.keys()).sort()) {
      const group = byBank.get(code)!;
      out.push({ kind: "group", key: `g-${code}`, cells: [`${code}${bankName(code) ? ` — ${bankName(code)}` : ""}`] });
      let bankTotal = 0;
      // Legacy sections: Unconfirmed first (red header), then Confirmed.
      const sections: Array<{ label: string; items: Voucher[]; highlight: boolean }> = [
        { label: "Unconfirmed Payment Voucher(s)", items: group.filter((v) => isUnconfirmed(v)), highlight: true },
        { label: "Confirmed Payment Voucher(s)", items: group.filter((v) => !isUnconfirmed(v)), highlight: false },
      ];
      for (const sec of sections) {
        if (!sec.items.length) continue;
        out.push({ kind: "row", key: `s-${code}-${sec.label}`, cells: [{ text: sec.label }, "", "", null, "", null], highlight: sec.highlight });
        let subTotal = 0;
        for (const v of sec.items.sort((a, b) => String(a.paymentDate || "").localeCompare(String(b.paymentDate || "")) || pvNo(a).localeCompare(pvNo(b)))) {
          const amt = R(Number(v.amount) || 0);
          subTotal = R(subTotal + amt);
          out.push({
            kind: "row",
            key: v.id,
            cells: [pvNo(v), v.paymentDate ? fmtDate(v.paymentDate) : "", v.supplierName || "", amt, currency(v), foreignAmount(v)],
          });
        }
        out.push({ kind: "subtotal", key: `st-${code}-${sec.label}`, cells: ["SUB-TOTAL", "", "", subTotal, "", null] });
        bankTotal = R(bankTotal + subTotal);
      }
      out.push({ kind: "subtotal", key: `t-${code}`, cells: ["TOTAL", "", "", bankTotal, "", null] });
      grand = R(grand + bankTotal);
    }
    out.push({ kind: "total", key: "__grand", cells: ["GRAND TOTAL", "", "", grand, "", null] });
    return out;
  }, [filtered]);

  const exportCsv = () => {
    if (!filtered) return;
    downloadCsv(`Payment-Voucher-Listing-${from}-${to}.csv`, [
      ["P/V No.", "Date", "Payee", "Bank Account", "Status", "Amount", "Curr", "Foreign Amount"],
      ...filtered.map((v) => [
        pvNo(v),
        String(v.paymentDate || "").slice(0, 10),
        v.supplierName || "",
        v.bankAccount?.code || "",
        isUnconfirmed(v) ? "Unconfirmed" : "Confirmed",
        R(Number(v.amount) || 0).toFixed(2),
        currency(v),
        foreignAmount(v).toFixed(2),
      ]),
    ]);
  };

  return (
    <ReportShell
      title="Payment Voucher Listing"
      loading={loading}
      onUpdate={() => load()}
      filters={
        <>
          <DateRangeSelect label="Period" from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
          <FilterSelect label="Bank account" value={bank} width={260} onChange={setBank} options={bankOptions} />
        </>
      }
      headerLines={filtered ? [`From ${fmtDate(from)} to ${fmtDate(to)}`] : []}
      footerInfo={filtered ? `${filtered.length} payment voucher${filtered.length === 1 ? "" : "s"}` : ""}
      onExportCsv={filtered ? exportCsv : undefined}
    >
      {filtered ? <ReportTable columns={columns} rows={rows} /> : null}
    </ReportShell>
  );
}
