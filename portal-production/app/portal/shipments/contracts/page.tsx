/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Contracts list (supplier contract / PI level) — secondary to the Shipments
// tracker. Row click opens the deal page (the contract with its shipments).

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Box, Button, IconButton, Menu, MenuItem, Typography } from "@mui/material";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import { useTranslations } from "next-intl";
import { toast } from "../_lib/toast";
import PageTable from "@/components/PageTable";
import type { FilterField } from "@/components/FilterDrawer";
import type { ContractListItem } from "../_lib/api";
import { useContracts, useCustomers, useSuppliers, useTradeMutation } from "../_lib/hooks";
import { fmtMonth, fmtMt } from "../_lib/format";
import { ConfirmDialog, CurrentStepCell, EmptyState, ProgressCell, RecordStatusChip } from "../_components/bits";
import PiBulkDialog from "../_components/PiBulkDialog";
import ContractFormDialog from "../_components/ContractFormDialog";
import { useDebounced } from "../_components/useDebounced";

const STATUS_OPTIONS = [
  { value: "OPEN", key: "statusOpen" },
  { value: "COMPLETED", key: "statusCompleted" },
  { value: "CANCELLED", key: "statusCancelled" },
] as const;

type Filters = { status: string; supplierId: string; customerId: string };

export default function ContractsPage() {
  const router = useRouter();
  const t = useTranslations("contracts.list");
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
  const [bulkOpen, setBulkOpen] = useState(false);
  const [menu, setMenu] = useState<{ pos: { left: number; top: number }; row: ContractListItem } | null>(null);
  const [toDelete, setToDelete] = useState<ContractListItem | null>(null);
  const del = useTradeMutation((api, id: string) => api.deleteContract(id));

  const filterConfig: FilterField[] = useMemo(
    () => [
      { type: "select", key: "status", label: t("status"), options: STATUS_OPTIONS.map((o) => ({ value: o.value, label: t(o.key) })) },
      { type: "select", key: "supplierId", label: t("supplier"), options: (suppliers.data ?? []).map((c) => ({ value: c.id, label: c.name })) },
      { type: "select", key: "customerId", label: t("customer"), options: (customers.data ?? []).map((c) => ({ value: c.id, label: c.name })) },
    ],
    [suppliers.data, customers.data, t],
  );

  const columns = useMemo(
    () => [
      { id: "contractNo", header: t("contractNo"), cell: ({ row }: any) => <Typography variant="body2" sx={{ fontWeight: 600 }}>{row.original.contractNo}</Typography> },
      { id: "pi", header: t("piNo"), cell: ({ row }: any) => row.original.piNumber || "—" },
      { id: "supplier", header: t("supplier"), cell: ({ row }: any) => row.original.supplier?.name || "—" },
      { id: "customer", header: t("customer"), cell: ({ row }: any) => row.original.customer?.name || "—" },
      { id: "products", header: t("products"), cell: ({ row }: any) => row.original.linesSummary || "—" },
      { id: "qty", header: t("qtyMt"), cell: ({ row }: any) => <Box sx={{ fontVariantNumeric: "tabular-nums", textAlign: "right" }}>{fmtMt(row.original.totalQuantityMt)}</Box> },
      { id: "month", header: t("shipmentMonth"), cell: ({ row }: any) => fmtMonth(row.original.shipmentMonth) },
      { id: "shipments", header: t("nShipments"), cell: ({ row }: any) => <Box sx={{ textAlign: "center" }}>{row.original.shipmentCount}</Box> },
      { id: "progress", header: t("progress"), cell: ({ row }: any) => <ProgressCell progress={row.original.progress} width={80} /> },
      { id: "currentStep", header: t("currentStep"), cell: ({ row }: any) => <CurrentStepCell step={row.original.currentStep} progress={row.original.progress} maxWidth={200} /> },
      { id: "status", header: t("status"), cell: ({ row }: any) => <RecordStatusChip status={row.original.status} /> },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }: any) => (
          <IconButton
            size="small"
            aria-label={t("actions")}
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
    [t],
  );

  const items = list.data?.items ?? [];
  const filtered = !!(q || filters.status || filters.supplierId || filters.customerId);

  return (
    <Box sx={{ p: { xs: 1.5, md: 3 }, height: "100%" }}>
      <PageTable
        tableName={t("title")}
        buttonName={t("newContract")}
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
            {t("fromPis")}
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
            <Alert severity="error">{(list.error as Error)?.message || t("loadError")}</Alert>
          ) : !list.isLoading && !items.length ? (
            filtered ? (
              <EmptyState title={t("noMatch")} />
            ) : (
              <EmptyState
                title={t("none")}
                action={
                  <Button variant="contained" onClick={() => setCreateOpen(true)}>
                    {t("newContract")}
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
          {t("open")}
        </MenuItem>
        <MenuItem
          sx={{ color: "error.main" }}
          onClick={() => {
            const r = menu!.row;
            setMenu(null);
            setToDelete(r);
          }}
        >
          {t("delete")}
        </MenuItem>
      </Menu>

      <ConfirmDialog
        open={!!toDelete}
        title={t("deleteTitle", { no: toDelete?.contractNo ?? "" })}
        body={t("deleteBody")}
        confirmLabel={t("delete")}
        destructive
        onClose={() => setToDelete(null)}
        onConfirm={async () => {
          await del.mutateAsync(toDelete!.id);
          toast.success(t("deleted"));
        }}
      />

      <PiBulkDialog open={bulkOpen} onClose={() => setBulkOpen(false)} />
      <ContractFormDialog open={createOpen} onClose={() => setCreateOpen(false)} onSaved={(c) => router.push(`/portal/shipments/contracts/${c.id}`)} />
    </Box>
  );
}
