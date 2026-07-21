"use client";

// Audit Trail (legacy screenshots 55/56 — guru 2026-07-20: Xero-style):
// flat listing of every posted journal LINE for a period, filterable by
// document prefix (e.g. OR = receipts, INV = invoices, MO = offsets),
// ordered By Document or By Date, with a grand debit/credit TOTAL and the
// legacy "All figures shown are in local currency" note. Print/CSV from the
// shell footer (covers the legacy Print Preview / Printer / File / Excel).
// Deep-linkable: ?tab=audit-trail&prefix=OR&from=&to= (the Official Receipt's
// side-rail Audit Trail button lands here scoped to receipts).

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Box, TextField, Typography } from "@mui/material";
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

type TrailRow = {
  date: string;
  docRef: string;
  accountCode: string;
  account: string;
  description: string;
  debit: number;
  credit: number;
};

export default function AuditTrailReport() {
  const { request } = useAccountingApi();
  const searchParams = useSearchParams();
  const init = monthRange();

  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [prefix, setPrefix] = useState("");
  const [order, setOrder] = useState<"document" | "date">("document");
  const [loading, setLoading] = useState(false);
  const [lines, setLines] = useState<TrailRow[] | null>(null);

  const load = useCallback(
    async (f = from, t = to) => {
      setLoading(true);
      try {
        const res = await request<any>(`/journal/reports/journal?startDate=${f}&endDate=${t}&orderBy=journalNumber`);
        const data = (res as any)?.data ?? res;
        const out: TrailRow[] = [];
        for (const j of data?.journals || []) {
          // Manual journals display as "J/V 000005" (doc-type prefix plan);
          // document-sourced journals carry their stamped reference.
          const docRef = j.reference || (j.journalNumber ? `J/V ${String(j.journalNumber).replace(/^JV-?/, "")}` : "");
          for (const l of j.lines || []) {
            out.push({
              date: l.date || j.entryDate,
              docRef,
              accountCode: l.accountCode || "",
              account: l.account || "",
              description: l.description || j.description || "",
              debit: Number(l.debit) || 0,
              credit: Number(l.credit) || 0,
            });
          }
        }
        setLines(out);
      } catch (e: any) {
        toast.error(e?.message || "Failed to load the audit trail");
      } finally {
        setLoading(false);
      }
    },
    [request, from, to],
  );

  // Deep-link (?prefix&from&to) — e.g. the receipt rail lands here with OR.
  const deepLinked = useRef(false);
  useEffect(() => {
    if (deepLinked.current) return;
    deepLinked.current = true;
    const pf = searchParams?.get("prefix");
    const f = searchParams?.get("from") || from;
    const t = searchParams?.get("to") || to;
    if (pf) setPrefix(pf);
    if (searchParams?.get("from")) setFrom(f);
    if (searchParams?.get("to")) setTo(t);
    void load(f, t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    if (!lines) return null;
    const pf = prefix.trim().toLowerCase();
    const rows = pf ? lines.filter((l) => l.docRef.toLowerCase().startsWith(pf)) : [...lines];
    rows.sort((a, b) =>
      order === "document"
        ? a.docRef.localeCompare(b.docRef) || String(a.date).localeCompare(String(b.date))
        : String(a.date).localeCompare(String(b.date)) || a.docRef.localeCompare(b.docRef),
    );
    return rows;
  }, [lines, prefix, order]);

  const totalDebit = R((filtered || []).reduce((s, l) => s + l.debit, 0));
  const totalCredit = R((filtered || []).reduce((s, l) => s + l.credit, 0));

  const columns = useMemo(
    () => [
      { key: "date", label: "Date", align: "left" as const, width: 105 },
      { key: "docRef", label: "Document-Ref", align: "left" as const, width: 140 },
      { key: "accn", label: "Accn", align: "left" as const, width: 90 },
      { key: "account", label: "Account", align: "left" as const },
      { key: "description", label: "Description / Remarks", align: "left" as const },
      { key: "debit", label: "Debit", align: "right" as const, width: 120 },
      { key: "credit", label: "Credit", align: "right" as const, width: 120 },
    ],
    [],
  );

  const rows = useMemo<ReportRow[]>(() => {
    if (!filtered) return [];
    const out: ReportRow[] = filtered.map((l, i) => ({
      kind: "row",
      key: `l${i}`,
      cells: [fmtDate(l.date), l.docRef, l.accountCode, l.account, l.description, l.debit || null, l.credit || null],
    }));
    out.push({ kind: "total", key: "__total", cells: ["TOTAL", "", "", "", "", totalDebit, totalCredit] });
    return out;
  }, [filtered, totalDebit, totalCredit]);

  const exportCsv = () => {
    if (!filtered) return;
    downloadCsv(`Audit-Trail-${prefix || "all"}-${from}-${to}.csv`, [
      columns.map((c) => c.label),
      ...filtered.map((l) => [fmtDate(l.date), l.docRef, l.accountCode, l.account, l.description, l.debit.toFixed(2), l.credit.toFixed(2)]),
      ["TOTAL", "", "", "", "", totalDebit.toFixed(2), totalCredit.toFixed(2)],
    ]);
  };

  return (
    <ReportShell
      title="Audit Trail"
      loading={loading}
      onUpdate={() => load()}
      filters={
        <>
          <DateRangeSelect label="Date range" from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
          <Box>
            <Typography variant="caption" sx={{ fontWeight: 700 }}>
              Document prefix
            </Typography>
            <TextField
              size="small"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value.toUpperCase())}
              placeholder="e.g. OR, INV, MO"
              sx={{ width: 160, mt: 0.25, display: "block" }}
            />
          </Box>
          <FilterSelect
            label="Order"
            value={order}
            width={150}
            onChange={(v) => setOrder(v as any)}
            options={[
              { value: "document", label: "By Document" },
              { value: "date", label: "By Date" },
            ]}
          />
        </>
      }
      headerLines={
        filtered
          ? [
              `From ${fmtDate(from)} to ${fmtDate(to)}`,
              ...(prefix ? [`Document prefix: ${prefix}`] : []),
            ]
          : []
      }
      footerInfo={filtered ? `${filtered.length} line${filtered.length === 1 ? "" : "s"}` : ""}
      onExportCsv={filtered ? exportCsv : undefined}
    >
      {filtered ? (
        <>
          <ReportTable columns={columns} rows={rows} />
          <Typography variant="caption" sx={{ display: "block", mt: 1.5, color: "text.secondary" }}>
            Note: All figures shown are in local currency (SGD)
          </Typography>
        </>
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: "center" }}>
          Pick a period and press Update to build the audit trail.
        </Typography>
      )}
    </ReportShell>
  );
}
