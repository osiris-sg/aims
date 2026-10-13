"use client";

// Debtor Historical Listing (legacy screenshots 71/72 — guru 2026-07-20:
// Xero style, legacy words verbatim): per-debtor transaction history for a
// period — BALANCE B/F opening row, then every transaction with columns
// Reference | Date | Remarks | Curr | Debit | Credit | Curr | Foreign Amount
// | Rate — SUB-TOTAL per debtor (foreign column lands on the closing
// balance). From/To customer range defaults to first → last.
// Data: POST /statements/soa per customer (opening + period transactions),
// chunked; customers with no opening AND no activity are skipped in ranges.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Autocomplete, Box, TextField, Typography } from "@mui/material";
import { toast } from "react-toastify";
import { useAccountingApi } from "../api";
import ReportShell, { downloadCsv } from "./ReportShell";
import ReportTable, { ReportRow, fmtDate } from "./ReportTable";
import { DateRangeSelect } from "./DateRangeSelect";
import { soaSummaryOf, useSideContacts, type ReportSide } from "./side";

const R = (n: number) => Math.round(n * 100) / 100;
const fmtAbs = (n: number) =>
  Math.abs(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const unwrap = (r: any) => {
  let out = r;
  while (out && typeof out === "object" && out.success !== undefined && out.data !== undefined) out = out.data;
  return out;
};

const toISO = (y: number, m0: number, day: number) =>
  `${y}-${String(m0 + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
const yearStartISO = () => {
  const d = new Date();
  return toISO(d.getFullYear(), 0, 1);
};
const monthEndISO = (iso: string) => {
  const d = new Date(iso);
  return toISO(d.getFullYear(), d.getMonth(), new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate());
};

type DebtorBlock = {
  code: string;
  name: string;
  currency: string; // customer master currency
  rows: Array<{ reference: string; date: string | null; remarks: string; debit: number; credit: number }>;
  opening: number;
  closing: number;
  totalDebit: number;
  totalCredit: number;
};

export default function HistoricalListingReport({ side = "receivable" }: { side?: ReportSide }) {
  const { request } = useAccountingApi();
  const { sorted: sortedCustomers, codeOf, words } = useSideContacts(side);

  const [from, setFrom] = useState(yearStartISO());
  const [to, setTo] = useState(() => monthEndISO(new Date().toISOString().slice(0, 10)));
  const [fromCustomer, setFromCustomer] = useState<any>(null);
  const [toCustomer, setToCustomer] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [blocks, setBlocks] = useState<DebtorBlock[] | null>(null);

  // Legacy default: the range runs from the FIRST to the LAST customer code.
  useEffect(() => {
    if (!sortedCustomers.length) return;
    setFromCustomer((prev: any) => prev || sortedCustomers[0]);
    setToCustomer((prev: any) => prev || sortedCustomers[sortedCustomers.length - 1]);
  }, [sortedCustomers]);

  const load = useCallback(async () => {
    if (!fromCustomer && !toCustomer) {
      toast.warn(`Pick the ${words.party.toLowerCase()} range first`);
      return;
    }
    const a = fromCustomer || toCustomer;
    const b = toCustomer || fromCustomer;
    const [lo, hi] = codeOf(a).localeCompare(codeOf(b)) <= 0 ? [codeOf(a), codeOf(b)] : [codeOf(b), codeOf(a)];
    let targets = sortedCustomers.filter((c: any) => {
      const code = codeOf(c);
      return code && code.localeCompare(lo) >= 0 && code.localeCompare(hi) <= 0;
    });
    if (!targets.length) targets = [a];
    if (targets.length > 100) {
      toast.warn(`Range covers ${targets.length} ${words.partyPlural} — showing the first 100`);
      targets = targets.slice(0, 100);
    }
    setLoading(true);
    try {
      const built: DebtorBlock[] = [];
      const chunkSize = 5;
      for (let i = 0; i < targets.length; i += chunkSize) {
        const chunk = targets.slice(i, i + chunkSize);
        const soas = await Promise.all(
          chunk.map((c: any) =>
            request(words.soaUrl, {
              method: "POST",
              body: JSON.stringify({ [words.soaIdKey]: c.id, startDate: from, endDate: to, format: "json" }),
            }).catch(() => null),
          ),
        );
        chunk.forEach((c: any, j: number) => {
          const soa = unwrap(soas[j]);
          const txs: any[] = soa?.transactions || [];
          const sum = soaSummaryOf(soa);
          const opening = R(sum.opening);
          if (!txs.length && Math.abs(opening) < 0.005 && targets.length > 1) return;
          const rows = txs.map((t) => ({
            reference: t.reference || "",
            date: t.date || null,
            remarks: t.description || t.transactionType || "",
            debit: Number(t.debit) || 0,
            credit: Number(t.credit) || 0,
          }));
          built.push({
            code: codeOf(c),
            name: c.name || "",
            currency: String(c.currency || "SGD").toUpperCase(),
            rows,
            opening,
            closing: R(sum.closing),
            totalDebit: R(opening + rows.reduce((s, r) => s + r.debit, 0)),
            totalCredit: R(rows.reduce((s, r) => s + r.credit, 0)),
          });
        });
      }
      built.sort((x, y) => x.code.localeCompare(y.code));
      setBlocks(built);
      if (!built.length) toast.info("Nothing to show for that range");
    } catch (e: any) {
      toast.error(e?.message || "Failed to load the historical listing");
    } finally {
      setLoading(false);
    }
  }, [request, sortedCustomers, fromCustomer, toCustomer, from, to]);

  // Columns word-for-word from the legacy sheet. (Per-transaction foreign
  // amounts/rates aren't stored on the statement feed — the foreign pair is
  // filled for base-currency debtors and the sub-total's closing balance.)
  const columns = useMemo(
    () => [
      { key: "reference", label: "Reference", align: "left" as const, width: 150 },
      { key: "date", label: "Date", align: "left" as const, width: 105 },
      { key: "remarks", label: "Remarks", align: "left" as const },
      { key: "lcurr", label: "Curr", align: "left" as const, width: 65 },
      { key: "debit", label: "Debit", align: "right" as const, width: 120 },
      { key: "credit", label: "Credit", align: "right" as const, width: 120 },
      { key: "fcurr", label: "Curr", align: "left" as const, width: 65 },
      { key: "foreign", label: "Foreign Amount", align: "right" as const, width: 140 },
      { key: "rate", label: "Rate", align: "right" as const, width: 90 },
    ],
    [],
  );

  const rows = useMemo<ReportRow[]>(() => {
    if (!blocks) return [];
    const out: ReportRow[] = [];
    for (const bl of blocks) {
      const sgd = bl.currency === "SGD";
      out.push({ kind: "group", key: `g-${bl.code}`, cells: [`${bl.code}   ${bl.name}`] });
      if (Math.abs(bl.opening) > 0.005) {
        out.push({
          kind: "row",
          key: `bf-${bl.code}`,
          cells: [
            "BALANCE B/F",
            fmtDate(from),
            "BALANCE B/F",
            "SGD",
            bl.opening > 0 ? bl.opening : null,
            bl.opening < 0 ? -bl.opening : null,
            sgd ? "SGD" : bl.currency,
            sgd ? fmtAbs(bl.opening) : "",
            sgd ? "1.00000" : "",
          ],
        });
      }
      for (let i = 0; i < bl.rows.length; i++) {
        const r = bl.rows[i];
        const net = R(r.debit - r.credit);
        out.push({
          kind: "row",
          key: `r-${bl.code}-${i}`,
          cells: [
            r.reference,
            r.date ? fmtDate(r.date) : "",
            r.remarks,
            "SGD",
            r.debit || null,
            r.credit || null,
            sgd ? "SGD" : bl.currency,
            sgd ? (net < 0 ? `( ${fmtAbs(net)})` : fmtAbs(net)) : "",
            sgd ? "1.00000" : "",
          ],
        });
      }
      out.push({
        kind: "subtotal",
        key: `t-${bl.code}`,
        cells: ["SUB-TOTAL", "", "", "SGD", bl.totalDebit, bl.totalCredit, sgd ? "SGD" : bl.currency, fmtAbs(bl.closing), ""],
      });
    }
    return out;
  }, [blocks, from]);

  const exportCsv = () => {
    if (!blocks) return;
    const body: (string | number)[][] = [];
    for (const bl of blocks) {
      if (Math.abs(bl.opening) > 0.005) {
        body.push([bl.code, bl.name, "BALANCE B/F", from, "BALANCE B/F", bl.opening > 0 ? bl.opening.toFixed(2) : "", bl.opening < 0 ? (-bl.opening).toFixed(2) : ""]);
      }
      for (const r of bl.rows) {
        body.push([bl.code, bl.name, r.reference, r.date || "", r.remarks, r.debit ? r.debit.toFixed(2) : "", r.credit ? r.credit.toFixed(2) : ""]);
      }
      body.push([bl.code, bl.name, "SUB-TOTAL", "", "", bl.totalDebit.toFixed(2), bl.totalCredit.toFixed(2)]);
    }
    downloadCsv(`${words.party}-Historical-Listing-${from}-${to}.csv`, [
      ["Code", "Name", "Reference", "Date", "Remarks", "Debit", "Credit"],
      ...body,
    ]);
  };

  const customerPicker = (label: string, value: any, onChange: (v: any) => void) => (
    <Box>
      <Typography variant="caption" sx={{ fontWeight: 700 }}>
        {label}
      </Typography>
      <Autocomplete
        size="small"
        sx={{ width: 260, mt: 0.25 }}
        options={sortedCustomers}
        getOptionLabel={(o: any) => `${codeOf(o) ? `${codeOf(o)} — ` : ""}${o.name || ""}`}
        isOptionEqualToValue={(o: any, v: any) => o?.id === v?.id}
        value={value}
        onChange={(_, v) => onChange(v)}
        renderInput={(p) => <TextField {...p} placeholder={`Search ${words.contactNoun}`} />}
      />
    </Box>
  );

  return (
    <ReportShell
      title={`${words.party} Historical Listing`}
      loading={loading}
      onUpdate={() => load()}
      filters={
        <>
          <DateRangeSelect label="Period" from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
          {customerPicker(`From ${words.party}`, fromCustomer, setFromCustomer)}
          {customerPicker(`To ${words.party}`, toCustomer, setToCustomer)}
        </>
      }
      headerLines={
        blocks
          ? [
              `From Date : ${fmtDate(from)}   To Date : ${fmtDate(to)}`,
              `From ${words.party} : ${codeOf(fromCustomer) || "—"}   To ${words.party} : ${codeOf(toCustomer) || "—"}`,
            ]
          : []
      }
      footerInfo={blocks ? `${blocks.length} ${blocks.length === 1 ? words.party.toLowerCase() : words.partyPlural}` : ""}
      onExportCsv={blocks?.length ? exportCsv : undefined}
    >
      {blocks ? (
        <ReportTable columns={columns} rows={rows} />
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: "center" }}>
          Pick the period and the range, then press Update.
        </Typography>
      )}
    </ReportShell>
  );
}
