"use client";

// Xero-parity "Contact Transactions - Summary": pick a contact + period →
// Opening Balance / Movement / Closing Balance for that side of the ledger.
// Data: GET /statements/contact-transactions

import React, { useCallback, useMemo, useState } from "react";
import { Autocomplete, Box, TextField, Typography } from "@mui/material";
import { toast } from "react-toastify";
import { useAccountingApi } from "../api";
import { useGetCustomers, useGetSuppliers } from "@/app/portal/hooks/api";
import ReportShell, { downloadCsv } from "./ReportShell";
import ReportTable, { ReportRow, fmtDate } from "./ReportTable";
import { DateRangeSelect, FilterSelect } from "./DateRangeSelect";

const monthRange = () => {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const iso = (d: Date) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
};

export default function ContactTransactionsReport({ basePath }: { basePath: string }) {
  const { request } = useAccountingApi();
  const { customers } = useGetCustomers();
  const { suppliers } = useGetSuppliers();

  const init = monthRange();
  const [contactType, setContactType] = useState<"customer" | "supplier">("customer");
  const [contact, setContact] = useState<any>(null);
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const options = (contactType === "customer" ? customers : suppliers) || [];

  const load = useCallback(async () => {
    if (!contact?.id) { toast.warn("Pick a contact first"); return; }
    setLoading(true);
    try {
      const res = await request<any>(
        `/statements/contact-transactions?contactType=${contactType}&contactId=${contact.id}&from=${from}&to=${to}`,
      );
      setData(res?.data ?? res);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load report");
    } finally {
      setLoading(false);
    }
  }, [request, contactType, contact, from, to]);

  const columns = useMemo(() => [
    { key: "type", label: "Transaction Type", align: "left" as const },
    { key: "amount", label: "Amount", align: "right" as const, width: 160 },
  ], []);

  const rows = useMemo<ReportRow[]>(() => {
    if (!data) return [];
    return [
      { kind: "group", key: "sec", cells: [data.section] },
      { kind: "row", key: "open", cells: ["Opening Balance", data.openingBalance] },
      { kind: "row", key: "inv", cells: [`${data.section === "Receivables" ? "Invoiced" : "Billed"} during period`, data.invoiced] },
      { kind: "row", key: "set", cells: ["Payments / credits during period", data.settled ? -data.settled : 0] },
      { kind: "subtotal", key: "move", cells: ["Movement during period", data.movement] },
      { kind: "total", key: "close", cells: ["Closing Balance", data.closingBalance] },
    ];
  }, [data]);

  const exportCsv = () => {
    if (!data) return;
    downloadCsv(
      `Contact-Transactions-${data.contact?.name?.replace(/\s+/g, "_")}-${from}-${to}.csv`,
      [["Transaction Type", "Amount"], ...rows.filter((r) => r.kind !== "group").map((r) => [String(r.cells[0]), Number(r.cells[1] ?? 0).toFixed(2)])],
    );
  };

  return (
    <ReportShell
      title="Contact Transactions - Summary"
      breadcrumb={{ label: "Reports", href: basePath }}
      loading={loading}
      onUpdate={load}
      filters={
        <>
          <FilterSelect
            label="Contact type" value={contactType} width={140}
            onChange={(v) => { setContactType(v as any); setContact(null); setData(null); }}
            options={[{ value: "customer", label: "Customer" }, { value: "supplier", label: "Supplier" }]}
          />
          <Box>
            <Typography variant="caption" sx={{ fontWeight: 700 }}>Contact (required)</Typography>
            <Autocomplete
              size="small"
              sx={{ width: 280, mt: 0.25 }}
              options={options}
              getOptionLabel={(o: any) => o?.name || ""}
              value={contact}
              onChange={(_, v) => setContact(v)}
              renderInput={(p) => <TextField {...p} placeholder="Search for contact" />}
            />
          </Box>
          <DateRangeSelect label="Date range" from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
        </>
      }
      headerLines={data ? [`${data.contact?.name} - Summary`, `For the period ${fmtDate(from)} to ${fmtDate(to)}`] : []}
      footerInfo={data ? "Showing items 1-4 of 4" : ""}
      onExportCsv={data ? exportCsv : undefined}
    >
      {data ? (
        <ReportTable columns={columns} rows={rows} />
      ) : (
        <Box sx={{ py: 6, textAlign: "center" }}>
          <Typography variant="body2" color="text.secondary">
            {loading ? "Loading…" : "Pick a contact and date range, then press Update."}
          </Typography>
        </Box>
      )}
    </ReportShell>
  );
}
