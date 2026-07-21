"use client";

// Statement-Of-Accounts (legacy screenshots 61/62 — guru 2026-07-20: Xero
// style + From/To customer-code RANGE for month-end statement runs): pick a
// customer range + period ending + scope and every customer's statement
// renders on screen, one section per customer (statement table + Ageing
// Analysis). Print (shell footer) page-breaks between customers; CSV exports
// the lot.
//   - "All outstanding" = open-item statement: everything still owed at the
//     start of the period (at its then-outstanding value) + the period's
//     transactions, running balance → closing = amount owed.
//   - "Current month" = BALANCE B/F line + the period's transactions.
// Deep-linkable: ?tab=debtor-statement&contactId=...&asOf=YYYY-MM-DD (the
// Official Receipt's Debtor Statement dialog links here — single customer).

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Autocomplete,
  Box,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  TextField,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { toast } from "react-toastify";
import { useAccountingApi } from "../api";
import { useGetCustomers } from "@/app/portal/hooks/api";
import ReportShell, { downloadCsv } from "./ReportShell";
import ReportTable, { ReportRow, fmtDate } from "./ReportTable";
import { FilterSelect } from "./DateRangeSelect";

const R = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) =>
  (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const unwrap = (r: any) => {
  let out = r;
  while (out && typeof out === "object" && out.success !== undefined && out.data !== undefined) out = out.data;
  return out;
};

const toISO = (y: number, m0: number, day: number) =>
  `${y}-${String(m0 + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
const monthEndISO = (iso: string) => {
  const d = new Date(iso);
  return toISO(d.getFullYear(), d.getMonth(), new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate());
};
const monthStartISO = (iso: string) => `${iso.slice(0, 7)}-01`;
const prevMonthEndISO = (iso: string) => {
  const d = new Date(monthStartISO(iso));
  return toISO(d.getFullYear(), d.getMonth() - 1, new Date(d.getFullYear(), d.getMonth(), 0).getDate());
};

const MONTH_LABELS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

type AgedDoc = { id: string; number: string; date: string; reference: string | null; total: number; currency: string | null };

function bucketizeByMonth(docs: AgedDoc[], cutISO: string) {
  const cut = new Date(cutISO);
  const list = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(cut.getFullYear(), cut.getMonth() - i, 1);
    const label = `${MONTH_LABELS[d.getMonth()]} ${d.getFullYear()}`;
    return { label: i === 11 ? `${label} & Below` : label, amount: 0, docs: [] as AgedDoc[] };
  });
  for (const doc of docs) {
    const d = new Date(doc.date);
    const diff = (cut.getFullYear() - d.getFullYear()) * 12 + (cut.getMonth() - d.getMonth());
    const idx = Math.min(Math.max(diff, 0), 11);
    list[idx].amount = R(list[idx].amount + (Number(doc.total) || 0));
    list[idx].docs.push(doc);
  }
  return list;
}

type StRow = { reference: string; date: string | null; remarks: string; debit: number; credit: number; running: number };
type CustomerStatement = {
  customer: { id: string; name: string; code: string };
  rows: StRow[];
  totalDebit: number;
  totalCredit: number;
  closing: number;
  buckets: ReturnType<typeof bucketizeByMonth>;
};

export default function DebtorStatementReport() {
  const { request } = useAccountingApi();
  const { customers = [] } = useGetCustomers({ limit: 1000 });
  const searchParams = useSearchParams();

  const [fromCustomer, setFromCustomer] = useState<any>(null);
  const [toCustomer, setToCustomer] = useState<any>(null);
  const [asOf, setAsOf] = useState(() => monthEndISO(new Date().toISOString().slice(0, 10)));
  const [scope, setScope] = useState<"outstanding" | "current">("outstanding");
  const [loading, setLoading] = useState(false);
  const [statements, setStatements] = useState<CustomerStatement[] | null>(null);
  const [monthDetail, setMonthDetail] = useState<{ label: string; docs: AgedDoc[] } | null>(null);

  const sortedCustomers = useMemo(
    () =>
      [...(customers || [])].sort((a: any, b: any) =>
        String(a.customerCode || "").localeCompare(String(b.customerCode || "")),
      ),
    [customers],
  );

  const load = useCallback(
    async (fromC = fromCustomer, toC = toCustomer, cut = asOf, sc = scope) => {
      if (!fromC?.id && !toC?.id) {
        toast.warn("Pick the customer range first");
        return;
      }
      const a = fromC || toC;
      const b = toC || fromC;
      const [lo, hi] =
        String(a.customerCode || "").localeCompare(String(b.customerCode || "")) <= 0
          ? [a.customerCode || "", b.customerCode || ""]
          : [b.customerCode || "", a.customerCode || ""];
      let targets = sortedCustomers.filter((c: any) => {
        const code = String(c.customerCode || "");
        return code && code.localeCompare(lo) >= 0 && code.localeCompare(hi) <= 0;
      });
      if (!targets.length) targets = [a];
      if (targets.length > 50) {
        toast.warn(`Range covers ${targets.length} customers — showing the first 50`);
        targets = targets.slice(0, 50);
      }
      setLoading(true);
      try {
        const prevEnd = prevMonthEndISO(cut);
        // One aged-detail call per as-of covers EVERY customer in the range.
        const [agedPrevRaw, agedNowRaw] = await Promise.all([
          request(`/statements/aged?side=receivable&asOf=${prevEnd}&level=detail&ageingBy=documentDate`),
          request(`/statements/aged?side=receivable&asOf=${cut}&level=detail&ageingBy=documentDate`),
        ]);
        const prevByContact = new Map<string, AgedDoc[]>(
          ((unwrap(agedPrevRaw)?.groups || []) as any[]).map((g: any) => [g.contactId, g.docs || []]),
        );
        const nowByContact = new Map<string, AgedDoc[]>(
          ((unwrap(agedNowRaw)?.groups || []) as any[]).map((g: any) => [g.contactId, g.docs || []]),
        );

        const built: CustomerStatement[] = [];
        // SOA is one POST per customer — chunk to keep concurrency sane.
        const chunkSize = 5;
        for (let i = 0; i < targets.length; i += chunkSize) {
          const chunk = targets.slice(i, i + chunkSize);
          const soas = await Promise.all(
            chunk.map((c: any) =>
              request(`/statements/soa`, {
                method: "POST",
                body: JSON.stringify({ customerId: c.id, startDate: monthStartISO(cut), endDate: cut, format: "json" }),
              }).catch(() => null),
            ),
          );
          chunk.forEach((c: any, j: number) => {
            const soa = unwrap(soas[j]);
            const monthTxs: any[] = soa?.transactions || [];
            const prevDocs = prevByContact.get(c.id) || [];
            const nowDocs = nowByContact.get(c.id) || [];

            const rows: StRow[] = [];
            let run = 0;
            if (sc === "outstanding") {
              for (const d of prevDocs) {
                run = R(run + (Number(d.total) || 0));
                rows.push({ reference: d.number, date: d.date, remarks: d.reference || "INVOICE", debit: Number(d.total) || 0, credit: 0, running: run });
              }
            } else {
              run = R(Number(soa?.statement?.openingBalance) || 0);
              rows.push({ reference: "", date: null, remarks: "BALANCE B/F", debit: 0, credit: 0, running: run });
            }
            for (const t of monthTxs) {
              run = R(run + (Number(t.debit) || 0) - (Number(t.credit) || 0));
              rows.push({
                reference: t.reference,
                date: t.date,
                remarks: t.description || t.transactionType,
                debit: Number(t.debit) || 0,
                credit: Number(t.credit) || 0,
                running: run,
              });
            }
            // A range run skips customers with nothing to say; an explicitly
            // picked single customer always shows (even if empty).
            const hasContent = rows.some((r) => r.debit || r.credit || Math.abs(r.running) > 0.005);
            if (!hasContent && targets.length > 1) return;
            built.push({
              customer: { id: c.id, name: c.name || "", code: c.customerCode || "" },
              rows,
              totalDebit: R(rows.reduce((s, r) => s + r.debit, 0)),
              totalCredit: R(rows.reduce((s, r) => s + r.credit, 0)),
              closing: run,
              buckets: bucketizeByMonth(nowDocs, cut),
            });
          });
        }
        setStatements(built);
        if (!built.length) toast.info("Nothing to show for that range");
      } catch (e: any) {
        toast.error(e?.message || "Failed to load the statements");
      } finally {
        setLoading(false);
      }
    },
    [request, sortedCustomers, fromCustomer, toCustomer, asOf, scope],
  );

  // Deep-link (?contactId&asOf) — e.g. from the Official Receipt's Debtor
  // Statement dialog (single customer). Auto-loads once the master resolves.
  const deepLinked = useRef(false);
  useEffect(() => {
    if (deepLinked.current || !sortedCustomers.length) return;
    const contactId = searchParams?.get("contactId");
    if (!contactId) return;
    const c = sortedCustomers.find((x: any) => x.id === contactId);
    if (!c) return;
    deepLinked.current = true;
    const cut = searchParams?.get("asOf") || asOf;
    setFromCustomer(c);
    setToCustomer(c);
    if (searchParams?.get("asOf")) setAsOf(cut);
    void load(c, c, cut, scope);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedCustomers, searchParams]);

  const columns = useMemo(
    () => [
      { key: "reference", label: "Reference", align: "left" as const },
      { key: "date", label: "Date", align: "left" as const, width: 110 },
      { key: "remarks", label: "Remarks", align: "left" as const },
      { key: "debit", label: "Debit", align: "right" as const, width: 130 },
      { key: "credit", label: "Credit", align: "right" as const, width: 130 },
      { key: "balance", label: "Balance", align: "right" as const, width: 140 },
    ],
    [],
  );

  const rowsFor = (s: CustomerStatement): ReportRow[] => [
    ...s.rows.map((r, i) => ({
      kind: "row" as const,
      key: `${s.customer.id}-r${i}`,
      cells: [r.reference, r.date ? fmtDate(r.date) : "", r.remarks, r.debit || null, r.credit || null, r.running] as any,
    })),
    { kind: "total" as const, key: `${s.customer.id}-total`, cells: ["TOTAL", "", "", s.totalDebit, s.totalCredit, s.closing] as any },
  ];

  const grandOwed = R((statements || []).reduce((s, st) => s + st.closing, 0));

  const exportCsv = () => {
    if (!statements?.length) return;
    downloadCsv(`Statement-Of-Accounts-${asOf}.csv`, [
      ["Customer", "Code", "Reference", "Date", "Remarks", "Debit", "Credit", "Balance"],
      ...statements.flatMap((s) => [
        ...s.rows.map((r) => [s.customer.name, s.customer.code, r.reference, r.date || "", r.remarks, r.debit.toFixed(2), r.credit.toFixed(2), r.running.toFixed(2)]),
        [s.customer.name, s.customer.code, "TOTAL", "", "", s.totalDebit.toFixed(2), s.totalCredit.toFixed(2), s.closing.toFixed(2)],
      ]),
    ]);
  };

  const customerPicker = (label: string, value: any, onChange: (v: any) => void) => (
    <Box>
      <Typography variant="caption" sx={{ fontWeight: 700 }}>
        {label}
      </Typography>
      <Autocomplete
        size="small"
        sx={{ width: 280, mt: 0.25 }}
        options={sortedCustomers}
        getOptionLabel={(o: any) => `${o.customerCode ? `${o.customerCode} — ` : ""}${o.name || ""}`}
        isOptionEqualToValue={(o: any, v: any) => o?.id === v?.id}
        value={value}
        onChange={(_, v) => onChange(v)}
        renderInput={(p) => <TextField {...p} placeholder="Search customer" />}
      />
    </Box>
  );

  return (
    <ReportShell
      title="Statement-Of-Accounts"
      loading={loading}
      onUpdate={() => load()}
      filters={
        <>
          {customerPicker("From customer", fromCustomer, (v) => {
            setFromCustomer(v);
            if (!toCustomer) setToCustomer(v);
          })}
          {customerPicker("To customer", toCustomer, (v) => {
            setToCustomer(v);
            if (!fromCustomer) setFromCustomer(v);
          })}
          <Box>
            <Typography variant="caption" sx={{ fontWeight: 700 }}>
              Period ending
            </Typography>
            <TextField
              size="small"
              type="date"
              value={asOf}
              onChange={(e) => e.target.value && setAsOf(e.target.value)}
              sx={{ width: 170, mt: 0.25, display: "block" }}
            />
          </Box>
          <FilterSelect
            label="Transactions"
            value={scope}
            width={180}
            onChange={(v) => setScope(v as any)}
            options={[
              { value: "outstanding", label: "All outstanding" },
              { value: "current", label: "Current month" },
            ]}
          />
        </>
      }
      headerLines={
        statements
          ? [
              `Period ending ${fmtDate(asOf)}`,
              scope === "outstanding" ? "All outstanding items" : "Current month transactions",
            ]
          : []
      }
      footerInfo={
        statements
          ? `${statements.length} customer${statements.length === 1 ? "" : "s"} · Total owed ${fmt(grandOwed)}`
          : ""
      }
      onExportCsv={statements?.length ? exportCsv : undefined}
    >
      {statements ? (
        <>
          {statements.map((s, si) => (
            <Box
              key={s.customer.id}
              sx={{
                mb: si < statements.length - 1 ? 4 : 0,
                "@media print": { pageBreakAfter: si < statements.length - 1 ? "always" : "auto" },
              }}
            >
              <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 0.5 }}>
                {s.customer.name}
                {s.customer.code ? ` (${s.customer.code})` : ""}
              </Typography>
              <ReportTable columns={columns} rows={rowsFor(s)} />

              <Typography variant="subtitle2" sx={{ fontWeight: 700, mt: 2, mb: 1 }}>
                Ageing Analysis
              </Typography>
              <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(3, 1fr)", md: "repeat(6, 1fr)" }, gap: 1 }}>
                {s.buckets.map((b) => (
                  <Paper
                    key={b.label}
                    variant="outlined"
                    onClick={() => b.amount > 0 && setMonthDetail({ label: `${s.customer.name} · ${b.label}`, docs: b.docs })}
                    title={b.amount > 0 ? "Detailed Ageing Analysis" : undefined}
                    sx={{
                      p: 1,
                      borderRadius: 1.5,
                      cursor: b.amount > 0 ? "pointer" : "default",
                      opacity: b.amount > 0 ? 1 : 0.65,
                      "&:hover": b.amount > 0 ? { borderColor: "text.secondary", bgcolor: "action.hover" } : undefined,
                    }}
                  >
                    <Typography sx={{ fontSize: "0.68rem", fontWeight: 700, color: "text.secondary", whiteSpace: "nowrap" }}>
                      {b.label}
                    </Typography>
                    <Typography
                      sx={{ fontFamily: "monospace", fontWeight: 700, textAlign: "right", color: b.amount > 0 ? "error.main" : "text.secondary" }}
                    >
                      {fmt(b.amount)}
                    </Typography>
                  </Paper>
                ))}
              </Box>
            </Box>
          ))}

          {/* Detailed Ageing Analysis drill */}
          <Dialog open={Boolean(monthDetail)} onClose={() => setMonthDetail(null)} maxWidth="sm" fullWidth>
            <DialogTitle
              sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", bgcolor: "#0a0a0a", color: "#fafafa", py: 1.5 }}
            >
              <Typography variant="h6" fontWeight={500}>
                Detailed Ageing Analysis · {monthDetail?.label}
              </Typography>
              <IconButton onClick={() => setMonthDetail(null)} size="small" sx={{ color: "#fafafa" }}>
                <CloseIcon />
              </IconButton>
            </DialogTitle>
            <DialogContent sx={{ p: 2 }}>
              <ReportTable
                columns={[
                  { key: "ref", label: "Reference", align: "left" },
                  { key: "date", label: "Date", align: "left", width: 110 },
                  { key: "remarks", label: "Remarks", align: "left" },
                  { key: "debit", label: "Debit", align: "right", width: 130 },
                ]}
                rows={[
                  ...(monthDetail?.docs || []).map((d, i) => ({
                    kind: "row" as const,
                    key: `d${i}`,
                    cells: [d.number, fmtDate(d.date), d.reference || "INVOICE", d.total] as any,
                  })),
                  {
                    kind: "total" as const,
                    key: "t",
                    cells: ["", "", "", R((monthDetail?.docs || []).reduce((s, d) => s + (Number(d.total) || 0), 0))] as any,
                  },
                ]}
              />
            </DialogContent>
          </Dialog>
        </>
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: "center" }}>
          Pick a customer range and press Update to build the statements.
        </Typography>
      )}
    </ReportShell>
  );
}
