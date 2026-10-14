/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Contracts list (supplier contract / PI level). Row click opens the contract.

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Box, Button, IconButton, Menu, MenuItem, Typography } from "@mui/material";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import { toast } from "../_lib/toast";
import PageTable from "@/components/PageTable";
import type { FilterField } from "@/components/FilterDrawer";
import type { ContractListItem } from "../_lib/api";
import { useContracts, useCustomers, useSuppliers, useTradeMutation } from "../_lib/hooks";
import { fmtMonth, fmtMt } from "../_lib/format";
import { ConfirmDialog, CurrentStepCell, EmptyState, ProgressCell, RecordStatusChip } from "../_components/bits";
import BlDefaultsDialog from "../_components/BlDefaultsDialog";
import DocSettingsDialog from "../_components/DocSettingsDialog";
import PiBulkDialog from "../_components/PiBulkDialog";
import ContractFormDialog from "../_components/ContractFormDialog";
import { useDebounced } from "../_components/useDebounced";

const STATUS_OPTIONS = [
  { value: "OPEN", label: "Open" },
  { value: "COMPLETED", label: "Completed" },
  { value: "CANCELLED", label: "Cancelled" },
];

type Filters = { status: string; supplierId: string; customerId: string };

export default function ContractsPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Filters>({ status: "", supplierId: "", customerId: "" });
  const q = useDebounced(search);
  const list = useContracts({
    page,
    pageSize: limit,
    q: q || undefined,
    status: filters.status || undefined,
    supplierId: filters.supplierId || undefined,
    customerId: filters.customerId || undefined,
  });
  const suppliers = useSuppliers();
  const customers = useCustomers();
  const [createOpen, setCreateOpen] = useState(false);
  const [defaultsOpen, setDefaultsOpen] = useState(false);
  const [docSettingsOpen, setDocSettingsOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [menu, setMenu] = useState<{ pos: { left: number; top: number }; row: ContractListItem } | null>(null);
  const [toDelete, setToDelete] = useState<ContractListItem | null>(null);
  const del = useTradeMutation((api, id: string) => api.deleteContract(id));

  const filterConfig: FilterField[] = useMemo(
    () => [
      { type: "select", key: "status", label: "Status", options: STATUS_OPTIONS },
      { type: "select", key: "supplierId", label: "Supplier", options: (suppliers.data ?? []).map((c) => ({ value: c.id, label: c.name })) },
      { type: "select", key: "customerId", label: "Customer", options: (customers.data ?? []).map((c) => ({ value: c.id, label: c.name })) },
    ],
    [suppliers.data, customers.data],
  );

  const columns = useMemo(
    () => [
      { id: "contractNo", header: "Contract no.", cell: ({ row }: any) => <Typography variant="body2" sx={{ fontWeight: 600 }}>{row.original.contractNo}</Typography> },
      { id: "pi", header: "PI no.", cell: ({ row }: any) => row.original.piNumber || "—" },
      { id: "supplier", header: "Supplier", cell: ({ row }: any) => row.original.supplier?.name || "—" },
      { id: "customer", header: "Customer", cell: ({ row }: any) => row.original.customer?.name || "—" },
      { id: "products", header: "Products", cell: ({ row }: any) => row.original.linesSummary || "—" },
      { id: "qty", header: "Qty MT", cell: ({ row }: any) => <Box sx={{ fontVariantNumeric: "tabular-nums", textAlign: "right" }}>{fmtMt(row.original.totalQuantityMt)}</Box> },
      { id: "month", header: "Shipment month", cell: ({ row }: any) => fmtMonth(row.original.shipmentMonth) },
      { id: "shipments", header: "# Shipments", cell: ({ row }: any) => <Box sx={{ textAlign: "center" }}>{row.original.shipmentCount}</Box> },
      { id: "progress", header: "Progress", cell: ({ row }: any) => <ProgressCell progress={row.original.progress} width={80} /> },
      { id: "currentStep", header: "Current step", cell: ({ row }: any) => <CurrentStepCell step={row.original.currentStep} progress={row.original.progress} maxWidth={200} /> },
      { id: "status", header: "Status", cell: ({ row }: any) => <RecordStatusChip status={row.original.status} /> },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }: any) => (
          <IconButton
            size="small"
            aria-label="Contract actions"
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
  const filtered = !!(q || filters.status || filters.supplierId || filters.customerId);

  return (
    <Box sx={{ p: { xs: 1.5, md: 3 }, height: "100%" }}>
      <PageTable
        tableName="Contracts"
        buttonName="New contract"
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
          setFilters({ status: f.status ?? "", supplierId: f.supplierId ?? "", customerId: f.customerId ?? "" });
          setPage(1);
        }}
        filterConfig={filterConfig}
        actionButtons={[
          <Button key="from-pis" variant="outlined" startIcon={<AutoAwesomeIcon />} onClick={() => setBulkOpen(true)}>
            New contracts from PIs
          </Button>,
          <Button key="bl-defaults" variant="outlined" startIcon={<SettingsOutlinedIcon />} onClick={() => setDefaultsOpen(true)}>
            B/L defaults
          </Button>,
          <Button key="doc-settings" variant="outlined" startIcon={<SettingsOutlinedIcon />} onClick={() => setDocSettingsOpen(true)}>
            Document settings
          </Button>,
        ]}
        pageCount={list.data?.totalPages ?? 1}
        totalDocs={list.data?.total}
        onRowClick={(r: ContractListItem) => router.push(`/portal/shipments/contracts/${r.id}`)}
        rowHref={(r: ContractListItem) => `/portal/shipments/contracts/${r.id}`}
        noSelectionColumn
        manualSorting
        hideTable={!list.isLoading && !list.isError && !items.length}
        headerContent={
          list.isError ? (
            <Alert severity="error">{(list.error as Error)?.message || "Could not load contracts"}</Alert>
          ) : !list.isLoading && !items.length ? (
            filtered ? (
              <EmptyState title="No contracts match these filters" />
            ) : (
              <EmptyState
                title="No contracts yet"
                action={
                  <Button variant="contained" onClick={() => setCreateOpen(true)}>
                    New contract
                  </Button>
                }
              />
            )
          ) : undefined
        }
      />

      <Menu anchorReference="anchorPosition" anchorPosition={menu?.pos} open={!!menu} onClose={() => setMenu(null)}>
        <MenuItem
          onClick={() => {
            const r = menu!.row;
            setMenu(null);
            router.push(`/portal/shipments/contracts/${r.id}`);
          }}
        >
          Open
        </MenuItem>
        <MenuItem
          onClick={() => {
            const r = menu!.row;
            setMenu(null);
            router.push(`/portal/shipments/contracts/${r.id}?tab=shipments`);
          }}
        >
          View shipments
        </MenuItem>
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
        title={`Delete contract ${toDelete?.contractNo ?? ""}?`}
        body="Only a contract without shipments can be deleted. Its steps and document links are removed; the files stay in the Documents library. This can't be undone."
        confirmLabel="Delete"
        destructive
        onClose={() => setToDelete(null)}
        onConfirm={async () => {
          await del.mutateAsync(toDelete!.id);
          toast.success("Contract deleted");
        }}
      />

      <BlDefaultsDialog open={defaultsOpen} onClose={() => setDefaultsOpen(false)} />
      <DocSettingsDialog open={docSettingsOpen} onClose={() => setDocSettingsOpen(false)} />
      <PiBulkDialog open={bulkOpen} onClose={() => setBulkOpen(false)} />
      <ContractFormDialog open={createOpen} onClose={() => setCreateOpen(false)} onSaved={(c) => router.push(`/portal/shipments/contracts/${c.id}`)} />
    </Box>
  );
}
