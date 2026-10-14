/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Shipments list (one row per B/L). Row click opens the shipment; the kebab
// holds the secondary actions.

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Box, Button, IconButton, Menu, MenuItem, Typography } from "@mui/material";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import { toast } from "./_lib/toast";
import PageTable from "@/components/PageTable";
import type { FilterField } from "@/components/FilterDrawer";
import type { ShipmentListItem } from "./_lib/api";
import { useCustomers, useShipments, useStepTemplates, useTradeMutation } from "./_lib/hooks";
import { blLabel, fmtDay, fmtMt, stepLabel } from "./_lib/format";
import { ConfirmDialog, CurrentStepCell, EmptyState, ProgressCell, RecordStatusChip } from "./_components/bits";
import ShipmentFormDialog from "./_components/ShipmentFormDialog";
import { useDebounced } from "./_components/useDebounced";

const STATUS_OPTIONS = [
  { value: "OPEN", label: "Open" },
  { value: "COMPLETED", label: "Completed" },
  { value: "CANCELLED", label: "Cancelled" },
];

export default function ShipmentsPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<{ status: string; customerId: string; currentStep: string }>({ status: "", customerId: "", currentStep: "" });
  const q = useDebounced(search);
  const list = useShipments({
    page,
    pageSize: limit,
    q: q || undefined,
    status: filters.status || undefined,
    customerId: filters.customerId || undefined,
    currentStep: filters.currentStep || undefined,
  });
  const customers = useCustomers();
  const templates = useStepTemplates("SHIPMENT");
  const [createOpen, setCreateOpen] = useState(false);
  const [menu, setMenu] = useState<{ pos: { left: number; top: number }; row: ShipmentListItem } | null>(null);
  const [toDelete, setToDelete] = useState<ShipmentListItem | null>(null);
  const del = useTradeMutation((api, id: string) => api.deleteShipment(id));

  const filterConfig: FilterField[] = useMemo(
    () => [
      { type: "select", key: "status", label: "Status", options: STATUS_OPTIONS },
      { type: "select", key: "customerId", label: "Customer", options: (customers.data ?? []).map((c) => ({ value: c.id, label: c.name })) },
      {
        type: "select",
        key: "currentStep",
        label: "Current step",
        // Numbered like the column: the org's step number, else the position.
        options: [
          ...(templates.data ?? [])
            .filter((t) => t.isActive && !t.isOngoing)
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((t, i) => ({ value: t.code, label: stepLabel(t, i + 1) })),
          { value: "COMPLETED", label: "Completed (all steps done)" },
        ],
      },
    ],
    [customers.data, templates.data],
  );

  const columns = useMemo(
    () => [
      { id: "bl", header: "B/L no.", cell: ({ row }: any) => <Typography variant="body2" sx={{ fontWeight: 600 }}>{blLabel(row.original.blNumber)}</Typography> },
      { id: "contract", header: "Contract no.", cell: ({ row }: any) => row.original.contractNo || "—" },
      { id: "customer", header: "Customer", cell: ({ row }: any) => row.original.customerName || "—" },
      { id: "product", header: "Product", cell: ({ row }: any) => row.original.productLine || "—" },
      { id: "vessel", header: "Vessel", cell: ({ row }: any) => [row.original.vessel, row.original.voyageNo].filter(Boolean).join(" / ") || "—" },
      { id: "etd", header: "ETD", cell: ({ row }: any) => fmtDay(row.original.etd) },
      { id: "eta", header: "Latest ETA", cell: ({ row }: any) => fmtDay(row.original.eta) },
      { id: "net", header: "Net MT", cell: ({ row }: any) => <Box sx={{ fontVariantNumeric: "tabular-nums", textAlign: "right" }}>{fmtMt(row.original.netWeightMt)}</Box> },
      { id: "progress", header: "Progress", cell: ({ row }: any) => <ProgressCell progress={row.original.progress} width={90} /> },
      { id: "currentStep", header: "Current step", cell: ({ row }: any) => <CurrentStepCell step={row.original.currentStep} progress={row.original.progress} maxWidth={300} /> },
      { id: "status", header: "Status", cell: ({ row }: any) => <RecordStatusChip status={row.original.status} /> },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }: any) => (
          <IconButton
            size="small"
            aria-label="Shipment actions"
            onClick={(e) => {
              e.stopPropagation();
              setMenu({ pos: { left: e.clientX, top: e.clientY }, row: row.original });
            }}
          >
            <MoreVertIcon fontSize="small" />
          </IconButton>
        ),
      },
    ],
    [],
  );

  const items = list.data?.items ?? [];
  const filtered = !!(q || filters.status || filters.customerId || filters.currentStep);

  return (
    <Box sx={{ p: { xs: 1.5, md: 3 }, height: "100%" }}>
      <PageTable
        tableName="Shipments"
        buttonName="New shipment"
        onAddClick={() => setCreateOpen(true)}
        columns={columns}
        data={items}
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
          setFilters({ status: f.status ?? "", customerId: f.customerId ?? "", currentStep: f.currentStep ?? "" });
          setPage(1);
        }}
        filterConfig={filterConfig}
        pageCount={list.data?.totalPages ?? 1}
        totalDocs={list.data?.total}
        onRowClick={(r: ShipmentListItem) => router.push(`/portal/shipments/${r.id}`)}
        rowHref={(r: ShipmentListItem) => `/portal/shipments/${r.id}`}
        noSelectionColumn
        manualSorting
        hideTable={!list.isLoading && !list.isError && !items.length}
        headerContent={
          list.isError ? (
            <Alert severity="error">{(list.error as Error)?.message || "Could not load shipments"}</Alert>
          ) : !list.isLoading && !items.length ? (
            filtered ? (
              <EmptyState title="No shipments match these filters" />
            ) : (
              <EmptyState title="No shipments yet" action={<Button variant="contained" onClick={() => setCreateOpen(true)}>New shipment</Button>} />
            )
          ) : undefined
        }
      />

      <Menu anchorReference="anchorPosition" anchorPosition={menu?.pos} open={!!menu} onClose={() => setMenu(null)}>
        <MenuItem
          onClick={() => {
            const r = menu!.row;
            setMenu(null);
            router.push(`/portal/shipments/${r.id}`);
          }}
        >
          Open
        </MenuItem>
        {menu?.row.contract && (
          <MenuItem
            onClick={() => {
              const r = menu!.row;
              setMenu(null);
              router.push(`/portal/shipments/contracts/${r.contract!.id}`);
            }}
          >
            Open contract
          </MenuItem>
        )}
        <MenuItem
          sx={{ color: "error.main" }}
          onClick={() => {
            const r = menu!.row;
            setMenu(null);
            setToDelete(r);
          }}
        >
          Delete
        </MenuItem>
      </Menu>

      <ConfirmDialog
        open={!!toDelete}
        title={`Delete shipment ${blLabel(toDelete?.blNumber)}?`}
        body="Its steps and document links are removed. The files themselves stay in the Documents library. This can't be undone."
        confirmLabel="Delete"
        destructive
        onClose={() => setToDelete(null)}
        onConfirm={async () => {
          await del.mutateAsync(toDelete!.id);
          toast.success("Shipment deleted");
        }}
      />

      <ShipmentFormDialog open={createOpen} onClose={() => setCreateOpen(false)} onSaved={(s) => router.push(`/portal/shipments/${s.id}`)} />
    </Box>
  );
}

