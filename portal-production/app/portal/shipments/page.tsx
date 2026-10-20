/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Orders — the main tracker (Contract → Order "#19" → Shipment "#19-1"), one
// order process (round H). A flat list (round K): ship month newest first, then
// order no. newest first, with a Ship month column + filter. One row per order:
// customer, contract, ship month, ship → delivery, product, quantity, number of
// shipments, a segmented progress bar ("Step 7 · … 9/14"; hover = each
// shipment's bar) and the status. The chevron expands a row into its
// shipments (#19-1 · B/L · vessel · ETA · current step); a shipment row opens
// the order page on that shipment. Tabs split Pending (open) from Completed
// (completed or cancelled). "New Order" opens the order form; "+ New monthly
// order" makes the month's orders from a small grid; "New orders from PIs"
// reads PIs in bulk.

import React, { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert, Box, Button, Chip, IconButton, Menu, MenuItem, Stack, Tab, Tabs, Typography } from "@mui/material";
import PlaylistAddIcon from "@mui/icons-material/PlaylistAdd";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRight";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import { toast } from "./_lib/toast";
import PageTable from "@/components/PageTable";
import type { FilterField } from "@/components/FilterDrawer";
import type { OrderListItem, OrderShipmentRow } from "./_lib/api";
import { useContracts, useCustomers, useOrders, useTradeMutation } from "./_lib/hooks";
import { blLabel, fmtDay, fmtMt } from "./_lib/format";
import { ConfirmDialog, EmptyState, RecordStatusChip } from "./_components/bits";
import ProgressBarCell from "./_components/ProgressBarCell";
import OrderFormDialog from "./_components/OrderFormDialog";
import PiBulkDialog from "./_components/PiBulkDialog";
import MonthlyOrderDialog from "./_components/MonthlyOrderDialog";
import { monthShort } from "./_lib/format";
import { useDebounced } from "./_components/useDebounced";

/** The table's rows: the orders and (expanded) their shipments right under them. */
type Row = ({ kind: "order" } & OrderListItem) | ({ kind: "shipment"; order: OrderListItem } & OrderShipmentRow);

const orderHref = (id: string, shipmentId?: string) => `/portal/shipments/orders/${id}${shipmentId ? `?shipment=${shipmentId}` : ""}`;

export default function OrdersPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [bucket, setBucket] = useState<"pending" | "completed">(params?.get("tab") === "completed" ? "completed" : "pending");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<{ contractId: string; customerId: string; shipMonth: string }>({ contractId: params?.get("contractId") ?? "", customerId: "", shipMonth: "" });
  const q = useDebounced(search);
  const list = useOrders({ page, pageSize: limit, q: q || undefined, bucket, contractId: filters.contractId || undefined, customerId: filters.customerId || undefined, shipMonth: filters.shipMonth || undefined });
  const customers = useCustomers();
  const contracts = useContracts({ pageSize: 100 });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [monthlyOpen, setMonthlyOpen] = useState(false);
  const [menu, setMenu] = useState<{ pos: { left: number; top: number }; row: OrderListItem } | null>(null);
  const [toDelete, setToDelete] = useState<OrderListItem | null>(null);
  const del = useTradeMutation((api, id: string) => api.deleteOrder(id));

  const toggle = (id: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const filterConfig: FilterField[] = useMemo(
    () => [
      { type: "select", key: "contractId", label: "Contract", options: (contracts.data?.items ?? []).map((c) => ({ value: c.id, label: [c.contractNo, c.customer?.name].filter(Boolean).join(" · ") })) },
      { type: "select", key: "customerId", label: "Customer", options: (customers.data ?? []).map((c) => ({ value: c.id, label: c.name })) },
      {
        type: "select",
        key: "shipMonth",
        label: "Ship month",
        options: (list.data?.months ?? []).map((m) => ({ value: m.month ?? "none", label: `${m.month ? monthShort(m.month) : "No ship month"} (${m.orders})` })),
      },
    ],
    [contracts.data, customers.data, list.data?.months],
  );

  // Flat: the server sorts (ship month newest first, then order no. newest first).
  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    for (const o of list.data?.items ?? []) {
      out.push({ kind: "order" as const, ...o });
      if (expanded.has(o.id)) out.push(...o.shipments.map((s) => ({ kind: "shipment" as const, order: o, ...s })));
    }
    return out;
  }, [list.data, expanded]);

  const columns = useMemo(
    () => [
      {
        id: "no",
        header: "#",
        cell: ({ row }: any) => {
          const r: Row = row.original;
          if (r.kind === "order") {
            const open = expanded.has(r.id);
            return (
              <Stack direction="row" alignItems="center" spacing={0.25} sx={{ whiteSpace: "nowrap" }}>
                <IconButton
                  size="small"
                  aria-label={open ? "Hide shipments" : "Show shipments"}
                  disabled={!r.shipmentCount}
                  data-tour="orders-expand"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(r.id);
                  }}
                >
                  {open ? <KeyboardArrowDownIcon fontSize="small" /> : <KeyboardArrowRightIcon fontSize="small" />}
                </IconButton>
                <Typography variant="body2" sx={{ fontWeight: 800 }}>
                  {r.label}
                </Typography>
              </Stack>
            );
          }
          return (
            <Typography variant="body2" sx={{ pl: 4.5, fontWeight: 600 }} color="text.secondary">
              {r.ref}
            </Typography>
          );
        },
      },
      {
        id: "customer",
        header: "Customer",
        cell: ({ row }: any) => {
          const r: Row = row.original;
          return r.kind === "order" ? r.customerName || "—" : <Typography variant="body2">B/L {blLabel(r.blNumber)}</Typography>;
        },
      },
      {
        id: "contract",
        header: "Contract",
        cell: ({ row }: any) => {
          const r: Row = row.original;
          return r.kind === "order" ? r.contractNo || "—" : <Typography variant="body2" color="text.secondary">{[r.vessel, r.voyageNo].filter(Boolean).join(" / ") || "Vessel —"}</Typography>;
        },
      },
      {
        id: "shipMonth",
        header: "Ship month",
        cell: ({ row }: any) => {
          const r: Row = row.original;
          return r.kind === "order" ? <Box sx={{ whiteSpace: "nowrap" }}>{r.shipMonth ? monthShort(r.shipMonth) : "—"}</Box> : null;
        },
      },
      {
        id: "months",
        header: "Ship → delivery",
        cell: ({ row }: any) => {
          const r: Row = row.original;
          // One line, never cut ("Oct 26 → Dec 26"): the column takes the width it needs.
          return <Box sx={{ whiteSpace: "nowrap" }}>{r.kind === "order" ? r.monthsLabel || "—" : <Typography variant="body2" color="text.secondary">ETA {fmtDay(r.eta)}</Typography>}</Box>;
        },
      },
      {
        id: "product",
        header: "Product",
        cell: ({ row }: any) =>
          row.original.kind === "order" ? [row.original.grade || row.original.product, row.original.size].filter(Boolean).join(" · ") || "—" : row.original.netWeightMt != null ? `${fmtMt(row.original.netWeightMt)} MT net` : "",
      },
      {
        id: "qty",
        header: "Qty (MT)",
        cell: ({ row }: any) => (row.original.kind === "order" ? <Box sx={{ fontVariantNumeric: "tabular-nums", textAlign: "right" }}>{row.original.qtyMt != null ? fmtMt(row.original.qtyMt) : "—"}</Box> : null),
      },
      {
        id: "ships",
        header: "Shipments",
        cell: ({ row }: any) => (row.original.kind === "order" ? <Chip size="small" variant="outlined" label={row.original.shipmentCount} /> : null),
      },
      {
        id: "progress",
        header: "Progress",
        // Its own column, wide enough for the bar; the step label wraps instead of running into Status.
        cell: ({ row }: any) => (
          <Box sx={{ minWidth: 200, maxWidth: 340, py: 0.5 }}>
            <ProgressBarCell bar={row.original.bar} shipments={row.original.kind === "order" ? row.original.shipments : undefined} />
          </Box>
        ),
      },
      { id: "status", header: "Status", cell: ({ row }: any) => <Box sx={{ whiteSpace: "nowrap" }}><RecordStatusChip status={row.original.status} /></Box> },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }: any) =>
          row.original.kind === "order" ? (
            <IconButton
              size="small"
              aria-label="Order actions"
              onClick={(e) => {
                e.stopPropagation();
                setMenu({ pos: { left: e.clientX, top: e.clientY }, row: row.original });
              }}
            >
              <MoreVertIcon fontSize="small" />
            </IconButton>
          ) : null,
      },
    ],
    [expanded],
  );

  const filtered = !!(q || filters.contractId || filters.customerId || filters.shipMonth);
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
  const hrefOf = (r: Row) => (r.kind === "order" ? orderHref(r.id) : orderHref(r.order.id, r.id));

  return (
    <Box sx={{ p: { xs: 1.5, md: 3 }, height: "100%" }}>
      <PageTable
        tableName="Orders"
        buttonName="+ New order"
        onAddClick={() => setCreateOpen(true)}
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
          setFilters({ contractId: f.contractId ?? "", customerId: f.customerId ?? "", shipMonth: f.shipMonth ?? "" });
          setPage(1);
        }}
        filterConfig={filterConfig}
        actionButtons={[
          <Button key="monthly" variant="outlined" startIcon={<PlaylistAddIcon />} onClick={() => setMonthlyOpen(true)} data-tour="orders-monthly">
            + New monthly order
          </Button>,
        ]}
        pageCount={list.data?.totalPages ?? 1}
        totalDocs={list.data?.total}
        onRowClick={(r: Row) => router.push(hrefOf(r))}
        rowHref={(r: Row) => hrefOf(r)}
        noSelectionColumn
        manualSorting
        hideTable={!list.isLoading && !list.isError && !list.data?.items?.length}
        headerContent={
          <>
            {tabs}
            {list.isError ? (
              <Alert severity="error">{(list.error as Error)?.message || "Could not load orders"}</Alert>
            ) : !list.isLoading && !list.data?.items?.length ? (
              filtered ? (
                <EmptyState title="No orders match these filters" />
              ) : bucket === "completed" ? (
                <EmptyState title="No completed orders yet" />
              ) : (
                <EmptyState title="No pending orders — start a new one" action={<Button variant="contained" onClick={() => setCreateOpen(true)}>+ New order</Button>} />
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
            router.push(orderHref(r.id));
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
        title={`Delete order ${toDelete?.label ?? ""}?`}
        body="Its steps, empty shipments and document links are removed (an order whose shipments have documents can't be deleted). The files themselves stay in the Documents library. This can't be undone."
        confirmLabel="Delete"
        destructive
        onClose={() => setToDelete(null)}
        onConfirm={async () => {
          await del.mutateAsync(toDelete!.id);
          toast.success("Order deleted");
        }}
      />

      <PiBulkDialog open={bulkOpen} onClose={() => setBulkOpen(false)} />
      <MonthlyOrderDialog
        open={monthlyOpen}
        onClose={() => setMonthlyOpen(false)}
        onImportPis={() => {
          setMonthlyOpen(false);
          setBulkOpen(true);
        }}
      />
      <OrderFormDialog open={createOpen} onClose={() => setCreateOpen(false)} onSaved={(o) => router.push(orderHref(o.id))} />
    </Box>
  );
}
