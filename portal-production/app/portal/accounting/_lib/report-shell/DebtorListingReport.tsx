"use client";

// Debtor Listing (legacy screenshots 69/70 — guru 2026-07-20: Xero style,
// legacy words verbatim): every debtor's balance as at the cut-off date —
// Code | Name | Curr | Local Amount (DR/CR) | Curr | Foreign Amount (DR/CR)
// — with the TOTAL row. From/To customer range defaults to first → last.
// Data: the aged-receivables summary (same engine as the AR home's balances).

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Autocomplete, Box, TextField, Typography } from "@mui/material";
import { toast } from "react-toastify";
import { useAccountingApi } from "../api";
import { useGetCustomers } from "@/app/portal/hooks/api";
import ReportShell, { downloadCsv } from "./ReportShell";
import ReportTable, { ReportRow, fmtDate } from "./ReportTable";

const R = (n: number) => Math.round(n * 100) / 100;
const fmtAbs = (n: number) =>
  Math.abs(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const drcr = (n: number) => (n < -0.005 ? "CR" : "DR");
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

type AgedRow = { contactId: string; contactName: string; total: number; currency: string | null; foreignTotal: number | null };

export default function DebtorListingReport() {
  const { request } = useAccountingApi();
  const { customers = [] } = useGetCustomers({ limit: 1000 });

  const [fromCustomer, setFromCustomer] = useState<any>(null);
  const [toCustomer, setToCustomer] = useState<any>(null);
  const [cutOff, setCutOff] = useState(() => monthEndISO(new Date().toISOString().slice(0, 10)));
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<AgedRow[] | null>(null);

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
      const res = await request(`/statements/aged?side=receivable&asOf=${cutOff}&level=summary`);
      setRows(unwrap(res)?.rows || []);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load the debtor listing");
    } finally {
      setLoading(false);
    }
  }, [request, cutOff]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    if (!rows) return null;
    const withCode = rows.map((r) => ({ ...r, code: customerById.get(r.contactId)?.customerCode || "" }));
    let out = withCode;
    if (fromCustomer || toCustomer) {
      const a = String((fromCustomer || toCustomer)?.customerCode || "");
      const b = String((toCustomer || fromCustomer)?.customerCode || "");
      const [lo, hi] = a.localeCompare(b) <= 0 ? [a, b] : [b, a];
      out = withCode.filter((r) => r.code && r.code.localeCompare(lo) >= 0 && r.code.localeCompare(hi) <= 0);
    }
    return out.sort((x, y) => x.code.localeCompare(y.code) || x.contactName.localeCompare(y.contactName));
  }, [rows, fromCustomer, toCustomer, customerById]);

  // Columns word-for-word from the legacy sheet.
  const columns = useMemo(
    () => [
      { key: "code", label: "Code", align: "left" as const, width: 90 },
      { key: "name", label: "Name", align: "left" as const },
      { key: "lcurr", label: "Curr", align: "left" as const, width: 70 },
      { key: "local", label: "Local Amount", align: "right" as const, width: 150 },
      { key: "fcurr", label: "Curr", align: "left" as const, width: 70 },
      { key: "foreign", label: "Foreign Amount", align: "right" as const, width: 160 },
    ],
    [],
  );

  const total = R((filtered || []).reduce((s, r) => s + (Number(r.total) || 0), 0));

  const tableRows = useMemo<ReportRow[]>(() => {
    if (!filtered) return [];
    const out: ReportRow[] = filtered.map((r) => {
      const foreignCurr = (r.currency || customerById.get(r.contactId)?.currency || "SGD").toUpperCase();
      const foreign = r.currency ? Number(r.foreignTotal) || 0 : Number(r.total) || 0;
      return {
        kind: "row",
        key: r.contactId,
        cells: [
          r.code,
          r.contactName,
          "SGD",
          `${fmtAbs(r.total)} ${drcr(r.total)}`,
          foreignCurr,
          `${fmtAbs(foreign)} ${drcr(foreign)}`,
        ],
      };
    });
    out.push({ kind: "total", key: "__total", cells: ["TOTAL", "", "", `${fmtAbs(total)} ${drcr(total)}`, "", ""] });
    return out;
  }, [filtered, total, customerById]);

  const exportCsv = () => {
    if (!filtered) return;
    downloadCsv(`Debtor-Listing-${cutOff}.csv`, [
      ["Code", "Name", "Curr", "Local Amount", "DR/CR", "Curr", "Foreign Amount", "DR/CR"],
      ...filtered.map((r) => {
        const foreignCurr = (r.currency || customerById.get(r.contactId)?.currency || "SGD").toUpperCase();
        const foreign = r.currency ? Number(r.foreignTotal) || 0 : Number(r.total) || 0;
        return [r.code, r.contactName, "SGD", fmtAbs(r.total), drcr(r.total), foreignCurr, fmtAbs(foreign), drcr(foreign)];
      }),
      ["TOTAL", "", "SGD", fmtAbs(total), drcr(total), "", "", ""],
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
      title="Debtor Listing"
      loading={loading}
      onUpdate={() => load()}
      filters={
        <>
          <Box>
            <Typography variant="caption" sx={{ fontWeight: 700 }}>
              Cut-Off-Date
            </Typography>
            <TextField
              size="small"
              type="date"
              value={cutOff}
              onChange={(e) => e.target.value && setCutOff(e.target.value)}
              sx={{ width: 170, mt: 0.25, display: "block" }}
            />
          </Box>
          {customerPicker("From Debtor", fromCustomer, setFromCustomer)}
          {customerPicker("To Debtor", toCustomer, setToCustomer)}
        </>
      }
      headerLines={
        filtered
          ? [
              `Period Ending : ${fmtDate(cutOff)}`,
              `From Debtor : ${fromCustomer?.customerCode || "—"}   To Debtor : ${toCustomer?.customerCode || "—"}`,
            ]
          : []
      }
      footerInfo={filtered ? `${filtered.length} debtor${filtered.length === 1 ? "" : "s"}` : ""}
      onExportCsv={filtered?.length ? exportCsv : undefined}
    >
      {filtered ? <ReportTable columns={columns} rows={tableRows} /> : null}
    </ReportShell>
  );
}
