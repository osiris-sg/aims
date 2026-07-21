"use client";

// Debtor Summary Ageing Analysis (legacy screenshots 63/64 — guru 2026-07-20:
// Xero style): outstanding per customer bucketed by CALENDAR MONTH of the
// document date — Current, 30/60/90/120/150 DAYS, "& Older" — plus Balance,
// with the customer master line (Tel · Contact) in each group header, an
// optional Details view (each customer's outstanding documents in their
// buckets), a GRAND-TOTAL and the legacy local-currency note. From/To
// customer-code range (blank = all customers). Print/CSV in the footer.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Autocomplete, Box, TextField, Typography } from "@mui/material";
import { toast } from "react-toastify";
import { useAccountingApi } from "../api";
import { useGetCustomers } from "@/app/portal/hooks/api";
import ReportShell, { downloadCsv } from "./ReportShell";
import ReportTable, { ReportRow, fmtDate } from "./ReportTable";
import { FilterSelect } from "./DateRangeSelect";

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

type AgedDoc = { id: string; number: string; date: string; reference: string | null; total: number; currency: string | null };

// 8 columns of amounts: 6 named months (Current..150 DAYS), "& Older", Balance.
const N_MONTHS = 6;

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
  return Math.min(Math.max(diff, 0), N_MONTHS); // N_MONTHS = "& Older"
}

export default function SummaryAgeingReport() {
  const { request } = useAccountingApi();
  const { customers = [] } = useGetCustomers({ limit: 1000 });

  const [fromCustomer, setFromCustomer] = useState<any>(null);
  const [toCustomer, setToCustomer] = useState<any>(null);
  const [asOf, setAsOf] = useState(() => monthEndISO(new Date().toISOString().slice(0, 10)));
  const [details, setDetails] = useState<"summary" | "details">("summary");
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

  // Customer-code range filter (blank = all).
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

  // Columns word-for-word from the legacy sheet: CODE | NAME | month (Current)
  // | months (30..150 DAYS) | & > | BALANCE.
  const cols = monthColumns(asOf);
  const columns = useMemo(
    () => [
      { key: "code", label: "CODE", align: "left" as const, width: 90 },
      { key: "name", label: "NAME", align: "left" as const },
      ...cols.map((c, i) => ({ key: `m${i}`, label: `${c.label} ${c.sub}`, align: "right" as const, width: 112 })),
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
      const buckets = Array(N_MONTHS + 1).fill(0);
      for (const d of g.docs) {
        const idx = bucketIndex(d.date, asOf);
        buckets[idx] = R(buckets[idx] + (Number(d.total) || 0));
      }
      const total = R(buckets.reduce((s, v) => s + v, 0));
      // Legacy line 1: (CODE) NAME + the amounts.
      out.push({
        kind: "row",
        key: `c-${g.contactId}`,
        cells: [`(${g.code || "—"})`, g.contactName, ...buckets.map((v) => v || null), total],
      });
      // Legacy line 2: Tel : / Contact : (Term and Credit Limit aren't in the
      // customer master — omitted).
      const info = [`Tel : ${master?.phone || ""}`, `Contact : ${master?.contacts?.[0]?.name || ""}`].join("   ");
      out.push({ kind: "row", key: `i-${g.contactId}`, cells: ["", info, ...Array(N_MONTHS + 1).fill(""), ""] });
      if (details === "details") {
        for (const d of g.docs) {
          const idx = bucketIndex(d.date, asOf);
          const docCells = Array(N_MONTHS + 1).fill(null);
          docCells[idx] = Number(d.total) || 0;
          out.push({
            kind: "row",
            key: `d-${d.id}`,
            cells: ["", `${d.number} · ${fmtDate(d.date)}`, ...docCells, Number(d.total) || 0],
          });
        }
        out.push({
          kind: "subtotal",
          key: `t-${g.contactId}`,
          cells: ["", "Total", ...buckets.map((v) => v || null), total],
        });
      }
      buckets.forEach((v, i) => (grand[i] = R(grand[i] + v)));
      grandTotal = R(grandTotal + total);
    }
    out.push({ kind: "total", key: "__grand", cells: ["GRAND-TOTAL", "", ...grand.map((v) => v || 0), grandTotal] });
    return out;
  }, [filteredGroups, details, asOf, customerById]);

  const exportCsv = () => {
    if (!filteredGroups) return;
    downloadCsv(`Summary-Ageing-Analysis-${asOf}.csv`, [
      ["CODE", "NAME", ...cols.map((c) => `${c.label} ${c.sub}`), "& >", "BALANCE"],
      ...filteredGroups.map((g) => {
        const buckets = Array(N_MONTHS + 1).fill(0);
        for (const d of g.docs) {
          const idx = bucketIndex(d.date, asOf);
          buckets[idx] = R(buckets[idx] + (Number(d.total) || 0));
        }
        return [g.code, g.contactName, ...buckets.map((v) => v.toFixed(2)), R(buckets.reduce((s, v) => s + v, 0)).toFixed(2)];
      }),
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
      title="Debtor Summary Ageing Analysis"
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
          <FilterSelect
            label="Details"
            value={details}
            width={170}
            onChange={(v) => setDetails(v as any)}
            options={[
              { value: "summary", label: "Summary only" },
              { value: "details", label: "Show documents" },
            ]}
          />
        </>
      }
      headerLines={filteredGroups ? [`Period ending ${fmtDate(asOf)}`] : []}
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
