/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Supplier orders — what ADH buys (Vedanta's PI per contract / customer /
// declaration month). One row per supplier order: PI, contract, month, grade,
// quantity, the customer orders bought under it, current step (0 contract,
// 1 PI payment). The toggle goes back to customer orders; "Declaration" makes
// a month's supplier + customer orders in one go.

import React, { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert, Box, Button, Chip, Stack, Tab, Tabs, ToggleButton, ToggleButtonGroup } from "@mui/material";
import PlaylistAddIcon from "@mui/icons-material/PlaylistAdd";
import PageTable from "@/components/PageTable";
import type { FilterField } from "@/components/FilterDrawer";
import type { SupplierOrderListItem } from "../_lib/api";
import { useContracts, useSupplierOrders } from "../_lib/hooks";
import { fmtMoney, fmtMt, monthShort } from "../_lib/format";
import { CurrentStepCell, EmptyState, RecordStatusChip } from "../_components/bits";
import { useDebounced } from "../_components/useDebounced";
import LegacyGate from "../_components/LegacyGate";

const soHref = (id: string) => `/portal/shipments/supplier-orders/${id}`;

function SupplierOrdersPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [bucket, setBucket] = useState<"pending" | "completed">(params?.get("tab") === "completed" ? "completed" : "pending");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<{ contractId: string }>({ contractId: "" });
  const q = useDebounced(search);
  const list = useSupplierOrders({ page, pageSize: limit, q: q || undefined, bucket, contractId: filters.contractId || undefined });
  const contracts = useContracts({ pageSize: 100 });
  const rows = list.data?.items ?? [];

  const filterConfig: FilterField[] = useMemo(
    () => [{ type: "select", key: "contractId", label: "Contract", options: (contracts.data?.items ?? []).map((c) => ({ value: c.id, label: [c.contractNo, c.customer?.name].filter(Boolean).join(" · ") })) }],
    [contracts.data],
  );

  const columns = useMemo(
    () => [
      { id: "label", header: "Supplier order", cell: ({ row }: any) => <b>{(row.original as SupplierOrderListItem).label}</b> },
      { id: "contract", header: "Contract", cell: ({ row }: any) => row.original.contractNo || "—" },
      { id: "month", header: "Declaration", nowrap: true, cell: ({ row }: any) => (row.original.declarationMonth ? monthShort(row.original.declarationMonth) : "—") },
      { id: "grade", header: "Grade", cell: ({ row }: any) => [row.original.grade, row.original.size].filter(Boolean).join(" · ") || "—" },
      { id: "qty", header: "Qty (MT)", cell: ({ row }: any) => <Box sx={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{row.original.qtyMt != null ? fmtMt(row.original.qtyMt) : "—"}</Box> },
      { id: "pi", header: "PI amount", cell: ({ row }: any) => (row.original.piAmount != null ? fmtMoney(row.original.piAmount, row.original.currency) : "—") },
      {
        id: "orders",
        header: "Customer orders",
        cell: ({ row }: any) => {
          const r = row.original as SupplierOrderListItem;
          if (!r.customerOrders.length) return "—";
          return (
            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
              {r.customerOrders.map((o) => (
                <Chip
                  key={o.id}
                  size="small"
                  variant="outlined"
                  label={`${o.label}${o.customerName ? ` · ${o.customerName}` : ""}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    router.push(`/portal/shipments/orders/${o.id}`);
                  }}
                />
              ))}
            </Stack>
          );
        },
      },
      { id: "currentStep", header: "Current step", cell: ({ row }: any) => <CurrentStepCell step={row.original.currentStep} progress={row.original.progress} maxWidth={240} /> },
      { id: "status", header: "Status", cell: ({ row }: any) => <RecordStatusChip status={row.original.status} /> },
    ],
    [router],
  );

  const counts = list.data?.counts;
  return (
    <Box sx={{ p: { xs: 1.5, md: 3 }, height: "100%" }}>
      <PageTable
        tableName="Orders"
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
        setFilters={(f) => {
          setFilters({ contractId: f.contractId ?? "" });
          setPage(1);
        }}
        filterConfig={filterConfig}
        actionButtons={[
          <Button key="declaration" variant="contained" startIcon={<PlaylistAddIcon />} href="/portal/shipments/declaration">
            Declaration
          </Button>,
        ]}
        pageCount={list.data?.totalPages ?? 1}
        totalDocs={list.data?.total}
        onRowClick={(r: SupplierOrderListItem) => router.push(soHref(r.id))}
        rowHref={(r: SupplierOrderListItem) => soHref(r.id)}
        noSelectionColumn
        manualSorting
        hideTable={!list.isLoading && !list.isError && !rows.length}
        headerContent={
          <>
            <ToggleButtonGroup size="small" exclusive value="supplier" onChange={(_, v) => v === "customer" && router.push("/portal/shipments")} sx={{ mb: 1 }}>
              <ToggleButton value="customer">Customer orders</ToggleButton>
              <ToggleButton value="supplier">Supplier orders</ToggleButton>
            </ToggleButtonGroup>
            <Tabs
              value={bucket}
              onChange={(_, v) => {
                setBucket(v);
                setPage(1);
              }}
              sx={{ minHeight: 40, "& .MuiTab-root": { minHeight: 40, textTransform: "none" } }}
            >
              <Tab value="pending" label={`Pending${counts ? ` (${counts.pending})` : ""}`} />
              <Tab value="completed" label={`Completed${counts ? ` (${counts.completed})` : ""}`} />
            </Tabs>
            {list.isError ? (
              <Alert severity="error">{(list.error as Error)?.message || "Could not load supplier orders"}</Alert>
            ) : !list.isLoading && !rows.length ? (
              <EmptyState title={bucket === "completed" ? "No completed supplier orders yet" : "No open supplier orders — make them from the month's declaration"} />
            ) : null}
          </>
        }
      />
    </Box>
  );
}

/** Hidden since round H (enableTradeLegacyPages, off by default). */
export default function GatedSupplierOrdersPage() {
  return (
    <LegacyGate what="The supplier-order list">
      <SupplierOrdersPage />
    </LegacyGate>
  );
}
