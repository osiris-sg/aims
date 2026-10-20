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
import { Alert, Box, Button, Menu, MenuItem, Stack, Tab, Tabs } from "@mui/material";
import PlaylistAddIcon from "@mui/icons-material/PlaylistAdd";
import { toast } from "./_lib/toast";
import PageTable from "@/components/PageTable";
import type { FilterField } from "@/components/FilterDrawer";
import type { OrderListItem } from "./_lib/api";
import { useContracts, useCustomers, useOrders, useTradeMutation } from "./_lib/hooks";
import { ConfirmDialog, EmptyState } from "./_components/bits";
import { orderColumns, type OrderRow } from "./_components/orderColumns";
import OrderFormDialog from "./_components/OrderFormDialog";
import PiBulkDialog from "./_components/PiBulkDialog";
import MonthlyOrderDialog from "./_components/MonthlyOrderDialog";
import { monthShort } from "./_lib/format";
import { useDebounced } from "./_components/useDebounced";
import ShowTestToggle, { useShowTestOrders } from "./_components/ShowTestToggle";

type Row = OrderRow;

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
  const [showTest, setShowTest] = useShowTestOrders();
  const list = useOrders({ page, pageSize: limit, q: q || undefined, bucket, contractId: filters.contractId || undefined, customerId: filters.customerId || undefined, shipMonth: filters.shipMonth || undefined, includeTest: showTest ? "true" : undefined });
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

  const columns = useMemo(() => orderColumns({ expanded, toggle, onMenu: (e, row) => setMenu({ pos: { left: e.clientX, top: e.clientY }, row }) }), [expanded]);

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
  const tabsRow = (
    <Stack direction="row" alignItems="center" spacing={1}>
      {tabs}
      <ShowTestToggle
        value={showTest}
        onChange={(v) => {
          setShowTest(v);
          setPage(1);
        }}
      />
    </Stack>
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
            {tabsRow}
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
