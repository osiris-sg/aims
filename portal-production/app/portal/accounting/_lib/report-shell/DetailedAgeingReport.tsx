"use client";

// Debtor Detailed Ageing Analysis (legacy screenshots 67/68 — guru 2026-07-20:
// Xero style, legacy words verbatim): every outstanding document per customer,
// aged into CALENDAR-MONTH buckets — columns DOCUMENT | DATE | month (Current)
// | months (30..150 DAYS) | & > | BALANCE (running within the customer) —
// group header "(CODE) NAME (CURR)" + the "Tel : Contact :" line, SUB-TOTAL
// per customer, GRAND-TOTAL, local-currency note. From/To customer range
// defaults to the first → last customer.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Autocomplete, Box, TextField, Typography } from "@mui/material";
import { toast } from "react-toastify";
import { useAccountingApi } from "../api";
import { useGetCustomers } from "@/app/portal/hooks/api";
import ReportShell, { downloadCsv } from "./ReportShell";
import ReportTable, { ReportRow, fmtDate } from "./ReportTable";

const R = (n: number) => Math.round(n * 100) / 100;
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

const MONTH_LABELS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const N_MONTHS = 6;

type AgedDoc = { id: string; number: string; date: string; reference: string | null; total: number; currency: string | null };

function monthColumns(cutISO: string) {
  const cut = new Date(cutISO);
  return Array.from({ length: N_MONTHS }, (_, i) => {
    const d = new Date(cut.getFullYear(), cut.getMonth() - i, 1);
    const label = `${MONTH_LABELS[d.getMonth()]} ${d.getFullYear()}`;
    return { label, sub: i === 0 ? "(Current)" : `(${i * 30} DAYS)` };
  });
}

function bucketIndex(docDate: string, cutISO: string) {
  const cut = new Date(cutISO);
  const d = new Date(docDate);
  const diff = (cut.getFullYear() - d.getFullYear()) * 12 + (cut.getMonth() - d.getMonth());
  return Math.min(Math.max(diff, 0), N_MONTHS); // N_MONTHS = "& >"
}

export default function DetailedAgeingReport() {
  const { request } = useAccountingApi();
  const { customers = [] } = useGetCustomers({ limit: 1000 });

  const [fromCustomer, setFromCustomer] = useState<any>(null);
  const [toCustomer, setToCustomer] = useState<any>(null);
  const [asOf, setAsOf] = useState(() => monthEndISO(new Date().toISOString().slice(0, 10)));
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState<Array<{ contactId: string; contactName: string; docs: AgedDoc[] }> | null>(null);

  const sortedCustomers = useMemo(
    () =>
      [...(customers || [])].sort((a: any, b: any) =>
        String(a.customerCode || "").localeCompare(String(b.customerCode || "")),
      ),
    [customers],
  );
  const customerById = useMemo(() => {
    const m = new Map<string, any>();
    for (const c of sortedCustomers) m.set(c.id, c);
    return m;
  }, [sortedCustomers]);

  // Legacy default: the range runs from the FIRST to the LAST customer code.
  useEffect(() => {
    if (!sortedCustomers.length) return;
    setFromCustomer((prev: any) => prev || sortedCustomers[0]);
    setToCustomer((prev: any) => prev || sortedCustomers[sortedCustomers.length - 1]);
  }, [sortedCustomers]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request(`/statements/aged?side=receivable&asOf=${asOf}&level=detail&ageingBy=documentDate`);
      setGroups(unwrap(res)?.groups || []);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load the ageing analysis");
    } finally {
      setLoading(false);
    }
  }, [request, asOf]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredGroups = useMemo(() => {
    if (!groups) return null;
    const withCode = groups.map((g) => ({ ...g, code: customerById.get(g.contactId)?.customerCode || "" }));
    let out = withCode;
    if (fromCustomer || toCustomer) {
      const a = String((fromCustomer || toCustomer)?.customerCode || "");
      const b = String((toCustomer || fromCustomer)?.customerCode || "");
      const [lo, hi] = a.localeCompare(b) <= 0 ? [a, b] : [b, a];
      out = withCode.filter((g) => g.code && g.code.localeCompare(lo) >= 0 && g.code.localeCompare(hi) <= 0);
    }
    return out.sort((x, y) => x.code.localeCompare(y.code) || x.contactName.localeCompare(y.contactName));
  }, [groups, fromCustomer, toCustomer, customerById]);

  // Columns word-for-word from the legacy sheet.
  const cols = monthColumns(asOf);
  const columns = useMemo(
    () => [
      { key: "document", label: "DOCUMENT", align: "left" as const, width: 150 },
      { key: "date", label: "DATE", align: "left" as const, width: 105 },
      ...cols.map((c, i) => ({ key: `m${i}`, label: `${c.label} ${c.sub}`, align: "right" as const, width: 108 })),
      { key: "older", label: "& >", align: "right" as const, width: 100 },
      { key: "balance", label: "BALANCE", align: "right" as const, width: 120 },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [asOf],
  );

  const rows = useMemo<ReportRow[]>(() => {
    if (!filteredGroups) return [];
    const out: ReportRow[] = [];
    const grand = Array(N_MONTHS + 1).fill(0);
    let grandTotal = 0;
    for (const g of filteredGroups) {
      const master = customerById.get(g.contactId);
      const currency = String(g.docs.find((d) => d.currency)?.currency || master?.currency || "SGD").toUpperCase();
      out.push({
        kind: "group",
        key: `g-${g.contactId}`,
        cells: [`(${g.code || "—"})  ${g.contactName}  (${currency})`],
      });
      // Legacy info line (Term and Credit Limit aren't in the customer master).
      const info = [`Tel : ${master?.phone || ""}`, `Contact : ${master?.contacts?.[0]?.name || ""}`].join("   ");
      out.push({ kind: "row", key: `i-${g.contactId}`, cells: ["", info, ...Array(N_MONTHS + 1).fill(""), ""] });

      const buckets = Array(N_MONTHS + 1).fill(0);
      let run = 0;
      const docs = [...g.docs].sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.number.localeCompare(b.number));
      for (const d of docs) {
        const idx = bucketIndex(d.date, asOf);
        const amt = Number(d.total) || 0;
        buckets[idx] = R(buckets[idx] + amt);
        run = R(run + amt);
        const docCells = Array(N_MONTHS + 1).fill(null);
        docCells[idx] = amt;
        out.push({ kind: "row", key: `d-${d.id}`, cells: [d.number, fmtDate(d.date), ...docCells, run] });
      }
      const total = R(buckets.reduce((s, v) => s + v, 0));
      out.push({ kind: "subtotal", key: `t-${g.contactId}`, cells: ["SUB-TOTAL", "", ...buckets.map((v) => v || 0), total] });
      buckets.forEach((v, i) => (grand[i] = R(grand[i] + v)));
      grandTotal = R(grandTotal + total);
    }
    out.push({ kind: "total", key: "__grand", cells: ["GRAND-TOTAL", "", ...grand.map((v) => v || 0), grandTotal] });
    return out;
  }, [filteredGroups, asOf, customerById]);

  const exportCsv = () => {
    if (!filteredGroups) return;
    const body: (string | number)[][] = [];
    for (const g of filteredGroups) {
      for (const d of g.docs) {
        const idx = bucketIndex(d.date, asOf);
        const buckets = Array(N_MONTHS + 1).fill("");
        buckets[idx] = (Number(d.total) || 0).toFixed(2);
        body.push([g.code, g.contactName, d.number, String(d.date).slice(0, 10), ...buckets, (Number(d.total) || 0).toFixed(2)]);
      }
    }
    downloadCsv(`Detailed-Ageing-Analysis-${asOf}.csv`, [
      ["CODE", "NAME", "DOCUMENT", "DATE", ...cols.map((c) => `${c.label} ${c.sub}`), "& >", "BALANCE"],
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
      title="Debtor Detailed Ageing Analysis"
      loading={loading}
      onUpdate={() => load()}
      filters={
        <>
          {customerPicker("From customer", fromCustomer, setFromCustomer)}
          {customerPicker("To customer", toCustomer, setToCustomer)}
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
        </>
      }
      headerLines={filteredGroups ? [`Period Ending : ${fmtDate(asOf)}`] : []}
      footerInfo={filteredGroups ? `${filteredGroups.length} customer${filteredGroups.length === 1 ? "" : "s"}` : ""}
      onExportCsv={filteredGroups?.length ? exportCsv : undefined}
    >
      {filteredGroups ? (
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
