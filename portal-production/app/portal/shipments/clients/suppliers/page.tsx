/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Round AM — Clients › Suppliers: Vedanta, MIND ID (Inalum), SIAE (trade suppliers: a supplier profile, a contract or an
// order — Mitsui Soko and ADH Pte stay in Master Files). Columns: name, contracts, open orders, PI status of the open
// orders (waiting / PI received / deposit paid; "no PI" for a supplier without one), pricing. Row → the profile.

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Box, Chip, Stack, Typography } from "@mui/material";
import PageTable from "@/components/PageTable";
import { useClientSuppliers } from "../../_lib/hooks";
import type { ClientSupplierRow } from "../../_lib/api";
import { ClientsHeader, T, useLang } from "../_components/ClientsBits";

export default function ClientsSuppliersPage() {
  const router = useRouter();
  const lang = useLang();
  const L = T[lang];
  const list = useClientSuppliers();
  const [search, setSearch] = useState("");
  const rows = useMemo(() => (list.data ?? []).filter((s) => !search || `${s.short} ${s.name}`.toLowerCase().includes(search.toLowerCase())), [list.data, search]);
  const columns = useMemo(
    () => [
      {
        id: "name",
        header: lang === "ja" ? "仕入先" : "Supplier",
        cell: ({ row }: any) => (
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 800 }}>{row.original.short}</Typography>
            <Typography variant="caption" color="text.secondary">{row.original.name}</Typography>
          </Box>
        ),
      },
      {
        id: "contracts",
        header: L.contracts,
        cell: ({ row }: any) => {
          const s: ClientSupplierRow = row.original;
          return s.contracts.length ? (
            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
              {s.contracts.map((k) => (
                <Chip key={k.contractNo} size="small" variant="outlined" label={k.contractNo} />
              ))}
            </Stack>
          ) : (
            "—"
          );
        },
      },
      { id: "open", header: L.openOrders, cell: ({ row }: any) => row.original.openOrders },
      {
        id: "pi",
        header: L.piStatus,
        cell: ({ row }: any) => {
          const s: ClientSupplierRow = row.original;
          if (!s.pi) return <Typography variant="body2" color="text.secondary">{lang === "ja" ? "PIなし" : "No PI (fixed price)"}</Typography>;
          return (
            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
              <Chip size="small" color={s.pi.waiting ? "warning" : "default"} variant="outlined" label={`${lang === "ja" ? "PI待ち" : "Waiting for PI"} ${s.pi.waiting}`} />
              <Chip size="small" variant="outlined" label={`${lang === "ja" ? "PI受領" : "PI received"} ${s.pi.received}`} />
              <Chip size="small" color="success" variant="outlined" label={`${lang === "ja" ? "前払金済" : "Deposit paid"} ${s.pi.depositPaid}`} />
            </Stack>
          );
        },
      },
      { id: "pricing", header: lang === "ja" ? "価格" : "Pricing", cell: ({ row }: any) => (row.original.pricingMode === "FIXED" ? (lang === "ja" ? "固定価格" : "Fixed price") : "LME + premium") },
    ],
    [lang, L],
  );
  const href = (s: ClientSupplierRow) => `/portal/shipments/clients/suppliers/${s.id}`;
  return (
    <Box sx={{ p: { xs: 1.5, md: 3 } }} data-tour="clients-suppliers">
      <ClientsHeader active="suppliers" />
      {list.isError && <Alert severity="error">{(list.error as Error)?.message || "Could not load suppliers"}</Alert>}
      <PageTable
        tableName={lang === "ja" ? "仕入先" : "Suppliers"}
        columns={columns as any}
        data={rows}
        loading={list.isLoading}
        search={search}
        setSearch={setSearch}
        onRowClick={(s: ClientSupplierRow) => router.push(href(s))}
        rowHref={href}
        noSelectionColumn
        totalDocs={rows.length}
      />
    </Box>
  );
}
