/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Payments — every bank movement (cash in from customers, cash out to
// Vedanta / customs / Mitsui Soko) and what it paid. A row opens the payment
// to edit or allocate; "Unallocated" shows movements whose lines don't add up
// to the amount yet.

import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Box, Button, Chip, Stack, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import PageTable from "@/components/PageTable";
import type { FilterField } from "@/components/FilterDrawer";
import { ACCOUNT_LABEL, useShipmentsApi, type TradePayment } from "../_lib/api";
import { SHIPMENT_KEYS } from "../_lib/hooks";
import { fmtDmy } from "../_lib/format";
import { EmptyState } from "../_components/bits";
import PaymentDialog from "../_components/PaymentDialog";
import { useDebounced } from "../_components/useDebounced";

const money = (v: number, c: string) => `${c} ${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function PaymentsPage() {
  const api = useShipmentsApi();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [search, setSearch] = useState("");
  const [direction, setDirection] = useState<"" | "IN" | "OUT">("");
  const [filters, setFilters] = useState<{ account: string; unallocated: string }>({ account: "", unallocated: "" });
  const q = useDebounced(search);
  const f = { page, pageSize: limit, q: q || undefined, direction: direction || undefined, account: filters.account || undefined, unallocated: filters.unallocated === "true" ? ("true" as const) : undefined };
  const list = useQuery({ queryKey: [...SHIPMENT_KEYS.orders, "payments", f], queryFn: () => api.listPayments(f) });
  const [edit, setEdit] = useState<TradePayment | null>(null);
  const [newDir, setNewDir] = useState<"IN" | "OUT" | null>(null);

  const filterConfig: FilterField[] = useMemo(
    () => [
      { type: "select", key: "account", label: "Account", options: (Object.keys(ACCOUNT_LABEL) as Array<keyof typeof ACCOUNT_LABEL>).map((a) => ({ value: a, label: ACCOUNT_LABEL[a] })) },
      { type: "select", key: "unallocated", label: "Allocation", options: [{ value: "true", label: "Has an unallocated remainder" }] },
    ],
    [],
  );
  const columns = useMemo(
    () => [
      { id: "date", header: "Date", nowrap: true, cell: ({ row }: any) => fmtDmy(row.original.paidAt) },
      { id: "dir", header: "", cell: ({ row }: any) => <Chip size="small" color={row.original.direction === "IN" ? "success" : "default"} variant="outlined" label={row.original.direction === "IN" ? "In" : "Out"} /> },
      { id: "amount", header: "Amount", cell: ({ row }: any) => <Box sx={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{money(row.original.amount, row.original.currency)}</Box> },
      { id: "account", header: "Account", cell: ({ row }: any) => ACCOUNT_LABEL[row.original.account as keyof typeof ACCOUNT_LABEL] ?? row.original.account },
      { id: "who", header: "Counterparty", cell: ({ row }: any) => row.original.counterpartyName || "—" },
      {
        id: "paid",
        header: "Paid",
        cell: ({ row }: any) => {
          const p = row.original as TradePayment;
          return (
            <Stack spacing={0.25}>
              {p.allocations.map((a) => (
                <Typography key={a.id ?? `${a.targetType}${a.targetId}`} variant="body2">
                  {a.targetLabel ?? a.targetType} · {money(a.amount, p.currency)}
                </Typography>
              ))}
              {!p.allocations.length && <Typography variant="body2" color="text.secondary">—</Typography>}
            </Stack>
          );
        },
      },
      {
        id: "left",
        header: "Unallocated",
        cell: ({ row }: any) => (row.original.unallocated > 0.004 ? <Chip size="small" color="warning" label={money(row.original.unallocated, row.original.currency)} /> : <Chip size="small" color="success" variant="outlined" label="allocated" />),
      },
      { id: "ref", header: "Reference", cell: ({ row }: any) => row.original.reference || "—" },
    ],
    [],
  );

  const rows = list.data?.items ?? [];
  return (
    <Box sx={{ p: { xs: 1.5, md: 3 }, height: "100%" }} data-tour="payments-page">
      <PageTable
        tableName="Payments"
        columns={columns}
        data={rows}
        loading={list.isLoading}
        page={page}
        limit={limit}
        search={search}
        setPage={setPage}
        setLimit={(l) => {
          setLimit(l);
          setPage(1);
        }}
        setSearch={(s) => {
          setSearch(s);
          setPage(1);
        }}
        filters={filters}
        setFilters={(x) => {
          setFilters({ account: x.account ?? "", unallocated: x.unallocated ?? "" });
          setPage(1);
        }}
        filterConfig={filterConfig}
        actionButtons={[
          <Button key="out" variant="outlined" onClick={() => setNewDir("OUT")}>
            Record payment (out)
          </Button>,
          <Button key="in" variant="contained" onClick={() => setNewDir("IN")}>
            Record receipt (in)
          </Button>,
        ]}
        pageCount={list.data?.totalPages ?? 1}
        totalDocs={list.data?.total}
        onRowClick={(r: TradePayment) => setEdit(r)}
        noSelectionColumn
        manualSorting
        hideTable={!list.isLoading && !rows.length}
        headerContent={
          <>
            <ToggleButtonGroup size="small" exclusive value={direction} onChange={(_, v) => v !== null && (setDirection(v), setPage(1))} sx={{ mb: 1 }}>
              <ToggleButton value="">All</ToggleButton>
              <ToggleButton value="OUT">Cash out</ToggleButton>
              <ToggleButton value="IN">Cash in</ToggleButton>
            </ToggleButtonGroup>
            {!list.isLoading && !rows.length && <EmptyState title="No payments yet — record one from a step (PI, CI, tax, logistics) or here" />}
          </>
        }
      />
      <PaymentDialog open={!!edit || !!newDir} payment={edit} context={newDir ? { direction: newDir } : undefined} onClose={() => (setEdit(null), setNewDir(null))} />
    </Box>
  );
}
