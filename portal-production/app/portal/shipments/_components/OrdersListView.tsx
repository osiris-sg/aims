"use client";

// Orders list (round AM: a component; was the Orders page) — the main tracker (Contract → Order "#19" → Shipment "#19-1"), one
// order process (round H). A flat list (round K): ship month newest first, then
// order no. newest first, with a Ship month column + filter. One row per order:
// customer, contract, ship month, ship → delivery, product, quantity, number of
// shipments, a segmented progress bar ("Step 7 · … 9/14"; hover = each
// shipment's bar) and the status. Round Q: no expand chevron — the row opens
// the order (each shipment's bar is in the progress hover). Tabs split Pending (open) from Completed
// (completed or cancelled). "New Order" opens the order form; "+ New monthly
// order" makes the month's orders from a small grid; "New orders from PIs"
// reads PIs in bulk. "Tasks (n)" (round O — no Home page) opens "My tasks
// today" in a side panel, the overdue count in red.
// Round AN: the page header is shared by both views — "Orders", + New order, Tasks, + New monthly order, Filter, Search,
// bell, and the List | Monthly switch with the Pending / Completed / All tabs stay put; only the content below changes
// (the table, or the Monthly view with its toolbar). Search, the main Filter and the tab apply to both views and survive
// the switch (one PageTable instance).

import React, { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert, Box, Button, Menu, MenuItem, Stack, Tab, Tabs } from "@mui/material";
import PlaylistAddIcon from "@mui/icons-material/PlaylistAdd";
import { toast } from "../_lib/toast";
import PageTable from "@/components/PageTable";
import type { FilterField } from "@/components/FilterDrawer";
import type { OrderListItem } from "../_lib/api";
import { useContracts, useCustomers, useOrders, useTradeMutation } from "../_lib/hooks";
import { ConfirmDialog, EmptyState } from "./bits";
import { orderColumns, type OrderRow } from "./orderColumns";
import OrderFormDialog from "./OrderFormDialog";
import PiBulkDialog from "./PiBulkDialog";
import MonthlyOrderDialog from "./MonthlyOrderDialog";
import { monthShort } from "../_lib/format";
import { useDebounced } from "./useDebounced";
import { TasksButton } from "./TradeTasks";
import MonthlyView from "./MonthlyView";
import OrdersViewToggle, { type OrdersView } from "./OrdersViewToggle";

type Row = OrderRow;

const orderHref = (id: string, shipmentId?: string) => `/portal/shipments/orders/${id}${shipmentId ? `?shipment=${shipmentId}` : ""}`;

type Bucket = "pending" | "completed" | "all";

/** Round AM: the Orders list as a component — the Orders page's List view, and a client's Orders tab (pre-filtered, no create buttons).
 * Round AN: with `view` it is the whole Orders page (or Orders tab) for both views — the shared header + the List table or the Monthly view. */
export default function OrdersListView({ fixedCustomerId, fixedSupplierId, toolbar, view = "list", onViewChange }: { fixedCustomerId?: string; fixedSupplierId?: string; toolbar?: React.ReactNode; view?: OrdersView; onViewChange?: (v: OrdersView) => void }) {
  const router = useRouter();
  const params = useSearchParams();
  const tabParam = params?.get("tab");
  const [bucket, setBucket] = useState<Bucket>(tabParam === "completed" || tabParam === "all" ? tabParam : "pending");
  const monthly = view === "monthly";
  const [monthlyCounts, setMonthlyCounts] = useState<{ pending: number; completed: number; all: number } | null>(null);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<{ contractId: string; customerId: string; shipMonth: string }>({ contractId: params?.get("contractId") ?? "", customerId: "", shipMonth: "" });
  const q = useDebounced(search);
  // Round W: test orders stay hidden for everyone (the "Show test orders" switch is gone).
  const fixed = !!(fixedCustomerId || fixedSupplierId);
  const list = useOrders({ page, pageSize: limit, q: q || undefined, bucket, contractId: filters.contractId || undefined, customerId: fixedCustomerId || filters.customerId || undefined, supplierId: fixedSupplierId || undefined, shipMonth: filters.shipMonth || undefined });
  const customers = useCustomers();
  const contracts = useContracts({ pageSize: 100 });
  const [createOpen, setCreateOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [monthlyOpen, setMonthlyOpen] = useState(false);
  const [menu, setMenu] = useState<{ pos: { left: number; top: number }; row: OrderListItem } | null>(null);
  const [toDelete, setToDelete] = useState<OrderListItem | null>(null);
  const del = useTradeMutation((api, id: string) => api.deleteOrder(id));

  const filterConfig: FilterField[] = useMemo(
    () => [
      { type: "select", key: "contractId", label: "Contract", options: (contracts.data?.items ?? []).map((c) => ({ value: c.id, label: [c.contractNo, c.customer?.name].filter(Boolean).join(" · ") })) },
      ...(fixedCustomerId ? [] : [{ type: "select" as const, key: "customerId", label: "Customer", options: (customers.data ?? []).map((c) => ({ value: c.id, label: c.name })) }]),
      {
        type: "select",
        key: "shipMonth",
        label: "Ship month",
        options: (list.data?.months ?? []).map((m) => ({ value: m.month ?? "none", label: `${m.month ? monthShort(m.month) : "No ship month"} (${m.orders})` })),
      },
    ],
    [contracts.data, customers.data, list.data?.months, fixedCustomerId]
  );

  // Flat: the server sorts (ship month newest first, then order no. newest first).
  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    for (const o of list.data?.items ?? []) {
      out.push({ kind: "order" as const, ...o });
    }
    return out;
  }, [list.data]);

  const columns = useMemo(() => orderColumns({ onMenu: (e, row) => setMenu({ pos: { left: e.clientX, top: e.clientY }, row }) }), []);

  const filtered = !!(q || filters.contractId || filters.customerId || filters.shipMonth);
  const listCounts = list.data?.counts;
  const counts = monthly ? monthlyCounts : listCounts ? { ...listCounts, all: listCounts.pending + listCounts.completed } : null;
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
      <Tab value="all" label={`All${counts ? ` (${counts.all})` : ""}`} data-tour="shipments-tab-all" />
    </Tabs>
  );
  const tabsRow = (
    <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
      {onViewChange ? <OrdersViewToggle view={view} onChange={onViewChange} /> : toolbar}
      {tabs}
    </Stack>
  );
  const hrefOf = (r: Row) => (r.kind === "order" ? orderHref(r.id) : orderHref(r.order.id, r.id));

  return (
    <Box sx={{ height: "100%" }}>
      <PageTable
        tableName="Orders"
        {...(fixed ? {} : { buttonName: "+ New order", onAddClick: () => setCreateOpen(true) })}
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
        actionButtons={
          fixed
            ? []
            : [
                <TasksButton key="tasks" />,
                <Button key="monthly" variant="outlined" startIcon={<PlaylistAddIcon />} onClick={() => setMonthlyOpen(true)} data-tour="orders-monthly">
                  + New monthly order
                </Button>,
              ]
        }
        pageCount={list.data?.totalPages ?? 1}
        totalDocs={list.data?.total}
        onRowClick={(r: Row) => router.push(hrefOf(r))}
        rowHref={(r: Row) => hrefOf(r)}
        noSelectionColumn
        manualSorting
        hideTable={monthly || (!list.isLoading && !list.isError && !list.data?.items?.length)}
        headerContent={
          <>
            {tabsRow}
            {monthly ? (
              <Box sx={{ mt: 1.5 }}>
                <MonthlyView customerId={fixedCustomerId} supplierId={fixedSupplierId} bucket={bucket} search={q} mainFilters={filters} onClientChange={fixedCustomerId ? undefined : (id) => setFilters((f) => ({ ...f, customerId: id }))} onCounts={setMonthlyCounts} />
              </Box>
            ) : list.isError ? (
              <Alert severity="error">{(list.error as Error)?.message || "Could not load orders"}</Alert>
            ) : !list.isLoading && !list.data?.items?.length ? (
              filtered ? (
                <EmptyState title="No orders match these filters" />
              ) : fixed ? (
                <EmptyState title={bucket === "completed" ? "No completed orders" : "No pending orders"} />
              ) : bucket === "completed" ? (
                <EmptyState title="No completed orders yet" />
              ) : (
                <EmptyState
                  title="No pending orders — start a new one"
                  action={
                    <Button variant="contained" onClick={() => setCreateOpen(true)}>
                      + New order
                    </Button>
                  }
                />
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
