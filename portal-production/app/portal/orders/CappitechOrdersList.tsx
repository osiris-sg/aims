"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import MainCard from "@/components/MainCard";
import PageTable from "@/components/PageTable";
import type { FilterField } from "@/components/FilterDrawer";
import { useGetCustomers } from "@/app/portal/hooks/api/useCustomers";
import { Box, Chip, IconButton, Stack, Tooltip, Typography } from "@mui/material";
import VisibilityIcon from "@mui/icons-material/Visibility";
import ShoppingCartIcon from "@mui/icons-material/ShoppingCart";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import ReceiptIcon from "@mui/icons-material/Receipt";
import AssignmentIcon from "@mui/icons-material/Assignment";
import moment from "moment";
import { toast } from "react-toastify";
import VerifySupplierUploadPanel from "./_components/VerifySupplierUploadPanel";

interface OrderRow {
  id: string;
  orderNumber: string;
  status: string;
  orderType: string | null;
  customerId: string | null;
  customer?: { id: string; name: string; customerCode: string | null } | null;
  sourceQuotation?: { id: string; name: string; status: string } | null;
  items: any[];
  linkedDocuments?: { po?: any[]; do?: any[]; invoice?: any[] };
  createdAt: string;
}

const statusColor = (status: string) => {
  const s = (status || "").toUpperCase();
  if (s === "DRAFT") return "default";
  if (s === "IN_PROGRESS") return "info";
  if (s === "COMPLETED") return "success";
  if (s === "CANCELLED") return "error";
  return "default";
};

// The rich Cappitech Orders list. Formerly the default export in ./page; now
// selected by OrdersListRouter (in ./page) when enableCappitechOrders is on.
// Logic unchanged — this file is a pure extraction.
export function CappitechOrdersList() {
  const router = useRouter();
  const { organization } = useOrganization();
  const { getToken } = useAuth();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<any>({ status: "", customerId: "", createdOn: { startDate: null, endDate: null } });

  const { customers = [] } = useGetCustomers({ limit: 1000 });

  const fetchOrders = useCallback(async () => {
    if (!organization?.id) return;
    setLoading(true);
    try {
      const token = await getToken();
      const res = await request({ path: "/orders", method: "GET" }, {}, token ?? undefined);
      if (res?.success && Array.isArray(res.data)) {
        setOrders(res.data);
      } else if (Array.isArray(res?.data)) {
        setOrders(res.data);
      } else {
        setOrders([]);
      }
    } catch (err) {
      console.error("Fetch orders failed:", err);
      toast.error("Failed to load orders");
    } finally {
      setLoading(false);
    }
  }, [organization?.id, getToken]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // Client-side filtering — search + status + createdOn range. The /orders
  // endpoint returns all rows; filtering here keeps it snappy without an extra
  // round-trip per filter change.
  const filteredOrders = useMemo(() => {
    const term = (search || "").trim().toLowerCase();
    const statusFilter = (filters?.status || "").trim();
    const customerFilter = (filters?.customerId || "").trim();
    const startDate = filters?.createdOn?.startDate ? new Date(filters.createdOn.startDate) : null;
    const endDate = filters?.createdOn?.endDate ? new Date(filters.createdOn.endDate) : null;
    if (endDate) endDate.setHours(23, 59, 59, 999); // inclusive

    return orders.filter((o) => {
      if (statusFilter && (o.status || "").toUpperCase() !== statusFilter.toUpperCase()) return false;
      if (customerFilter && (o.customerId || o.customer?.id) !== customerFilter) return false;
      if (startDate && new Date(o.createdAt) < startDate) return false;
      if (endDate && new Date(o.createdAt) > endDate) return false;
      if (term) {
        const haystack = [
          o.orderNumber,
          o.customer?.name,
          o.customer?.customerCode,
          o.sourceQuotation?.name,
          o.orderType,
          o.status,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [orders, search, filters]);

  const filterConfig: FilterField[] = useMemo(
    () => [
      { type: "dateRange", key: "createdOn", label: "Created On" },
      {
        type: "select",
        key: "status",
        label: "Status",
        options: [
          { value: "DRAFT", label: "Draft" },
          { value: "IN_PROGRESS", label: "In Progress" },
          { value: "COMPLETED", label: "Completed" },
          { value: "CANCELLED", label: "Cancelled" },
        ],
      },
      {
        type: "select",
        key: "customerId",
        label: "Customer",
        options: (customers || []).map((c: any) => ({ value: c.id, label: c.name })),
      },
    ],
    [customers],
  );

  // Hide Customer when no row carries one (Cappitech orders aren't
  // customer-linked yet); reappears automatically once customers are set.
  // The Table component reads `size` as a % of the table width — they don't
  // have to sum to 100 (extras get distributed), but giving the must-not-
  // truncate columns explicit budgets stops Order No. / From Quotation from
  // being squeezed when Linked + Ver. DO + Ver. INV are present.
  const hasAnyCustomer = (filteredOrders || []).some((o: any) => o?.customer?.id);

  const columns = ([
    {
      accessorKey: "orderNumber",
      header: "Order No.",
      size: 13,
      cell: ({ row }: any) => (
        <Typography variant="body2" sx={{ fontWeight: 500 }}>{row.original.orderNumber}</Typography>
      ),
    },
    hasAnyCustomer
      ? {
          accessorKey: "customer",
          header: "Customer",
          size: 12,
          cell: ({ row }: any) => row.original.customer?.name || "—",
        }
      : null,
    {
      accessorKey: "sourceQuotation",
      header: "From Quotation",
      size: 13,
      cell: ({ row }: any) => row.original.sourceQuotation?.name || "—",
    },
    {
      accessorKey: "orderType",
      header: "Type",
      size: 9,
      // Let "Route Order" wrap below if it doesn't fit, instead of clipping
      // to "Route Or…". Custom flag honoured by components/Table.tsx.
      wrap: true,
      cell: ({ row }: any) => (
        <Box sx={{ display: "flex", justifyContent: "center" }}>
          {row.original.orderType ? (
            <Chip
              size="small"
              variant="outlined"
              label={row.original.orderType}
              sx={{
                height: "auto",
                "& .MuiChip-label": {
                  whiteSpace: "normal",
                  wordBreak: "break-word",
                  lineHeight: 1.2,
                  py: 0.4,
                  textAlign: "center",
                },
              }}
            />
          ) : (
            <Typography variant="caption" color="text.disabled">—</Typography>
          )}
        </Box>
      ),
    },
    {
      accessorKey: "items",
      header: "Items",
      size: 5,
      cell: ({ row }: any) => Array.isArray(row.original.items) ? row.original.items.length : 0,
    },
    {
      accessorKey: "linkedDocuments",
      header: "Linked",
      size: 8,
      cell: ({ row }: any) => {
        const ld = row.original.linkedDocuments || {};
        return (
          <LinkedDocsCell
            so={(ld.salesOrder || []).length}
            po={(ld.po || []).length}
            doCount={(ld.do || []).length}
            inv={(ld.invoice || []).length}
          />
        );
      },
    },
    {
      accessorKey: "verifiedDo",
      header: "Ver. DO",
      size: 7,
      cell: ({ row }: any) => <VerifiedColumnChip items={row.original.items} kind="verifiedDo" />,
    },
    {
      accessorKey: "verifiedInv",
      header: "Ver. INV",
      size: 7,
      cell: ({ row }: any) => <VerifiedColumnChip items={row.original.items} kind="verifiedInv" />,
    },
    {
      accessorKey: "status",
      header: "Status",
      size: 8,
      cell: ({ row }: any) => (
        <Chip
          size="small"
          label={(row.original.status || "DRAFT").replace(/_/g, " ")}
          color={statusColor(row.original.status) as any}
          sx={{ textTransform: "capitalize" }}
        />
      ),
    },
    {
      accessorKey: "createdAt",
      header: "Created",
      size: 9,
      cell: ({ row }: any) => moment(row.original.createdAt).format("DD/MM/YYYY"),
    },
    {
      accessorKey: "action",
      header: "Action",
      size: 5,
      cell: ({ row }: any) => (
        <IconButton
          onClick={() => router.push(`/portal/orders/${row.original.id}`)}
          sx={{ color: "text.secondary", "&:hover": { color: "primary.main" } }}
        >
          <VisibilityIcon />
        </IconButton>
      ),
    },
  ] as Array<any>).filter(Boolean);

  return (
    <MainCard>
      <VerifySupplierUploadPanel />
      <PageTable
        columns={columns}
        data={filteredOrders}
        tableName="Orders"
        subTitle="Orders auto-created when quotations are confirmed. Spin off POs, DOs, and Invoices from inside each one."
        loading={loading}
        page={page}
        limit={limit}
        search={search}
        filters={filters}
        setPage={setPage}
        setLimit={setLimit}
        setSearch={setSearch}
        setFilters={setFilters}
        filterConfig={filterConfig}
        pageCount={1}
        totalDocs={filteredOrders.length}
      />
    </MainCard>
  );
}

/**
 * Per-row chip for the Ver. DO / Ver. INV columns. Counts how many of the
 * order's items carry the requested verification stamp:
 *   - all stamped → green "✓ All (N/N)"
 *   - some stamped → amber "Partial (X/N)"
 *   - none stamped → em-dash
 * The PO stamping path writes the same supplier-doc reference on every line
 * it verified, so this gives the user a fast at-a-glance signal of whether
 * an order has been reconciled against a DO or Invoice yet.
 */
/**
 * Compact Linked-Docs cell: one icon per doc kind (PO / DO / Invoice) shown
 * only when at least one of that kind exists, with the count beside it. Three
 * "1 PO" / "1 INV" chips compressed into <40 px so the table can breathe and
 * Ver. DO / Ver. INV fit beside it without truncating the rest.
 */
function LinkedDocsCell({ so, po, doCount, inv }: { so: number; po: number; doCount: number; inv: number }) {
  if (so + po + doCount + inv === 0) return <Typography variant="caption" color="text.disabled">—</Typography>;
  const item = (label: string, n: number, Icon: React.ElementType) =>
    n > 0 ? (
      <Tooltip arrow title={`${n} ${label}${n === 1 ? "" : "s"}`}>
        <Stack direction="row" spacing={0.25} alignItems="center" sx={{ color: "text.secondary" }}>
          <Icon sx={{ fontSize: 14 }} />
          <Typography variant="caption" sx={{ fontWeight: 600, fontSize: "0.7rem" }}>{n}</Typography>
        </Stack>
      </Tooltip>
    ) : null;
  return (
    <Stack direction="row" spacing={0.75}>
      {item("SO", so, AssignmentIcon)}
      {item("PO", po, ShoppingCartIcon)}
      {item("DO", doCount, LocalShippingIcon)}
      {item("Invoice", inv, ReceiptIcon)}
    </Stack>
  );
}

function VerifiedColumnChip({ items, kind }: { items: any[] | undefined; kind: "verifiedDo" | "verifiedInv" }) {
  const list = Array.isArray(items) ? items : [];
  const total = list.length;
  const verified = list.filter((it) => it && it[kind]).length;
  if (total === 0 || verified === 0) return <Typography variant="caption" color="text.disabled">—</Typography>;
  // Compact `verified/total` chip — green when fully reconciled, amber when
  // partial. The full status (which supplier doc, when) is visible per-item
  // on the order detail page.
  const fully = verified === total;
  return (
    <Chip
      size="small"
      color={fully ? "success" : "warning"}
      variant={fully ? "filled" : "outlined"}
      label={`${verified}/${total}`}
      sx={{ height: 20, fontSize: "0.7rem", "& .MuiChip-label": { px: 0.75 } }}
    />
  );
}
