/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Round AM — Clients › Customers: SUS, Kato, Hoei (+ any other trade customer: one with a profile, an order or a
// contract). Columns: name (short + full), open orders, tonnage this month / the 3 months before (order qty by
// delivery month), last delivery, invoice profile (billing mode). The row opens the customer's profile.

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Box, Chip, Typography } from "@mui/material";
import PageTable from "@/components/PageTable";
import { useClientCustomers } from "../../_lib/hooks";
import type { ClientCustomerRow } from "../../_lib/api";
import { fmtDay } from "../../_lib/format";
import { billingLabel, ClientsHeader, T, t3, useLang, ym } from "../_components/ClientsBits";

export default function ClientsCustomersPage() {
  const router = useRouter();
  const lang = useLang();
  const L = T[lang];
  const list = useClientCustomers();
  const [search, setSearch] = useState("");
  const rows = useMemo(() => (list.data ?? []).filter((c) => !search || `${c.short} ${c.name} ${c.jpName ?? ""}`.toLowerCase().includes(search.toLowerCase())), [list.data, search]);
  const columns = useMemo(
    () => [
      {
        id: "name",
        header: lang === "ja" ? "顧客" : "Customer",
        cell: ({ row }: any) => {
          const c: ClientCustomerRow = row.original;
          return (
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 800 }}>{c.short}</Typography>
              <Typography variant="caption" color="text.secondary">{[c.name, c.jpName].filter(Boolean).join(" · ")}</Typography>
            </Box>
          );
        },
      },
      { id: "open", header: L.openOrders, cell: ({ row }: any) => row.original.openOrders },
      { id: "month", header: L.thisMonth, cell: ({ row }: any) => t3(row.original.tonsThisMonth) },
      { id: "last3", header: L.last3, cell: ({ row }: any) => <span title={`${ym(row.original.last3From)} – ${ym(row.original.last3To)} (delivery month)`}>{t3(row.original.tonsLast3Months)}</span> },
      {
        id: "last",
        header: L.lastDelivery,
        cell: ({ row }: any) => {
          const d = (row.original as ClientCustomerRow).lastDelivery;
          return d ? `${d.date ? fmtDay(d.date) : ym(d.month)} · ${d.ref}` : "—";
        },
      },
      {
        id: "billing",
        header: L.invoice,
        cell: ({ row }: any) => {
          const c: ClientCustomerRow = row.original;
          return <Chip size="small" variant="outlined" color={c.billingMode === "SINGLE" ? "secondary" : "default"} label={`${billingLabel(c.billingMode, lang)}${c.hasProfile ? "" : " (default)"}`} />;
        },
      },
      { id: "contracts", header: L.contracts, cell: ({ row }: any) => row.original.contracts },
    ],
    [lang, L],
  );
  const href = (c: ClientCustomerRow) => `/portal/shipments/clients/customers/${c.id}`;
  return (
    <Box sx={{ p: { xs: 1.5, md: 3 } }} data-tour="clients-customers">
      <ClientsHeader active="customers" />
      {list.isError && <Alert severity="error">{(list.error as Error)?.message || "Could not load customers"}</Alert>}
      <PageTable
        tableName={lang === "ja" ? "顧客" : "Customers"}
        columns={columns as any}
        data={rows}
        loading={list.isLoading}
        search={search}
        setSearch={setSearch}
        onRowClick={(c: ClientCustomerRow) => router.push(href(c))}
        rowHref={href}
        noSelectionColumn
        totalDocs={rows.length}
      />
    </Box>
  );
}
