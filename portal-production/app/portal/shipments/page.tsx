/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Shipments list — the main tracker: one row per shipment (B/L pending until
// it is entered on step 2) with its contract and current step. Row click opens
// the deal page on that shipment. "New Shipment" starts a deal (the contract
// form; the contract arrives with shipment #1, B/L pending); more shipments are
// added on the deal page. Tabs split Pending (open) from Completed (completed
// or cancelled); the Contract filter (also ?contractId=) replaces the old
// Contracts menu entry.

import React, { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert, Box, Button, IconButton, Menu, MenuItem, Tab, Tabs, Typography } from "@mui/material";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import { toast } from "./_lib/toast";
import PageTable from "@/components/PageTable";
import type { FilterField } from "@/components/FilterDrawer";
import type { ShipmentListItem } from "./_lib/api";
import { useContracts, useCustomers, useShipments, useStepTemplates, useTradeMutation } from "./_lib/hooks";
import { blLabel, fmtDay, fmtMt, stepLabel } from "./_lib/format";
import { ConfirmDialog, CurrentStepCell, EmptyState, ProgressCell, RecordStatusChip } from "./_components/bits";
import ContractFormDialog from "./_components/ContractFormDialog";
import BlDefaultsDialog from "./_components/BlDefaultsDialog";
import DocSettingsDialog from "./_components/DocSettingsDialog";
import PiBulkDialog from "./_components/PiBulkDialog";
import { useDebounced } from "./_components/useDebounced";

/** The deal page, on this shipment. */
const dealHref = (r: ShipmentListItem) => `/portal/shipments/contracts/${r.contractId ?? r.contract?.id}?shipment=${r.id}`;

export default function ShipmentsPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [bucket, setBucket] = useState<"pending" | "completed">(params?.get("tab") === "completed" ? "completed" : "pending");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<{ contractId: string; customerId: string; currentStep: string }>({ contractId: params?.get("contractId") ?? "", customerId: "", currentStep: "" });
  const q = useDebounced(search);
  const list = useShipments({
    page,
    pageSize: limit,
    q: q || undefined,
    bucket,
    contractId: filters.contractId || undefined,
    customerId: filters.customerId || undefined,
    currentStep: filters.currentStep || undefined,
  });
  const customers = useCustomers();
  const contracts = useContracts({ pageSize: 100 });
  const templates = useStepTemplates("SHIPMENT");
  const [createOpen, setCreateOpen] = useState(false);
  // Moved here with the Contracts menu entry: bulk PIs, B/L defaults, document settings.
  const [bulkOpen, setBulkOpen] = useState(false);
  const [settingsMenu, setSettingsMenu] = useState<HTMLElement | null>(null);
  const [defaultsOpen, setDefaultsOpen] = useState(false);
  const [docSettingsOpen, setDocSettingsOpen] = useState(false);
  const [menu, setMenu] = useState<{ pos: { left: number; top: number }; row: ShipmentListItem } | null>(null);
  const [toDelete, setToDelete] = useState<ShipmentListItem | null>(null);
  const del = useTradeMutation((api, id: string) => api.deleteShipment(id));

  const filterConfig: FilterField[] = useMemo(
    () => [
      { type: "select", key: "contractId", label: "Contract", options: (contracts.data?.items ?? []).map((c) => ({ value: c.id, label: [c.contractNo, c.customer?.name].filter(Boolean).join(" · ") })) },
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
    [contracts.data, customers.data, templates.data],
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
  const filtered = !!(q || filters.contractId || filters.customerId || filters.currentStep);
  const counts = list.data?.counts;
  const tabs = (
    <Tabs
      value={bucket}
      onChange={(_, v) => {
        setBucket(v);
        setPage(1);
      }}
      sx={{ minHeight: 40, "& .MuiTab-root": { minHeight: 40, textTransform: "none" } }}
    >
      <Tab value="pending" label={`Pending${counts ? ` (${counts.pending})` : ""}`} data-tour="shipments-tab-pending" />
      <Tab value="completed" label={`Completed${counts ? ` (${counts.completed})` : ""}`} data-tour="shipments-tab-completed" />
    </Tabs>
  );

  return (
    <Box sx={{ p: { xs: 1.5, md: 3 }, height: "100%" }}>
      <PageTable
        tableName="Shipments"
        buttonName="New Shipment"
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
          setFilters({ contractId: f.contractId ?? "", customerId: f.customerId ?? "", currentStep: f.currentStep ?? "" });
          setPage(1);
        }}
        filterConfig={filterConfig}
        actionButtons={[
          <Button key="from-pis" variant="outlined" startIcon={<AutoAwesomeIcon />} onClick={() => setBulkOpen(true)}>
            New shipments from PIs
          </Button>,
          <Button key="settings" variant="outlined" startIcon={<SettingsOutlinedIcon />} onClick={(e) => setSettingsMenu(e.currentTarget)}>
            Settings
          </Button>,
        ]}
        pageCount={list.data?.totalPages ?? 1}
        totalDocs={list.data?.total}
        onRowClick={(r: ShipmentListItem) => router.push(dealHref(r))}
        rowHref={(r: ShipmentListItem) => dealHref(r)}
        noSelectionColumn
        manualSorting
        hideTable={!list.isLoading && !list.isError && !items.length}
        headerContent={
          <>
            {tabs}
            {list.isError ? (
              <Alert severity="error">{(list.error as Error)?.message || "Could not load shipments"}</Alert>
            ) : !list.isLoading && !items.length ? (
              filtered ? (
                <EmptyState title="No shipments match these filters" />
              ) : bucket === "completed" ? (
                <EmptyState title="No completed shipments yet" />
              ) : (
                <EmptyState title="No pending shipments — start a new deal" action={<Button variant="contained" onClick={() => setCreateOpen(true)}>New Shipment</Button>} />
              )
            ) : null}
          </>
        }
      />

      <Menu anchorReference="anchorPosition" anchorPosition={menu?.pos} open={!!menu} onClose={() => setMenu(null)}>
        <MenuItem
          onClick={() => {
            const r = menu!.row;
            setMenu(null);
            router.push(dealHref(r));
          }}
        >
          Open
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

      {/* A stable toolbar button (outside the table), so anchorEl is fine here. */}
      <Menu anchorEl={settingsMenu} open={!!settingsMenu} onClose={() => setSettingsMenu(null)}>
        <MenuItem
          onClick={() => {
            setSettingsMenu(null);
            setDefaultsOpen(true);
          }}
        >
          B/L defaults
        </MenuItem>
        <MenuItem
          onClick={() => {
            setSettingsMenu(null);
            setDocSettingsOpen(true);
          }}
        >
          Document settings
        </MenuItem>
      </Menu>
      <BlDefaultsDialog open={defaultsOpen} onClose={() => setDefaultsOpen(false)} />
      <DocSettingsDialog open={docSettingsOpen} onClose={() => setDocSettingsOpen(false)} />
      <PiBulkDialog open={bulkOpen} onClose={() => setBulkOpen(false)} />
      <ContractFormDialog open={createOpen} onClose={() => setCreateOpen(false)} onSaved={(c) => router.push(`/portal/shipments/contracts/${c.id}`)} />
    </Box>
  );
}

