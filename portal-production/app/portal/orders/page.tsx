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
import { Box, Chip, IconButton, Typography } from "@mui/material";
import VisibilityIcon from "@mui/icons-material/Visibility";
import moment from "moment";
import { toast } from "react-toastify";

interface OrderRow {
  id: string;
  orderNumber: string;
  status: string;
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

export default function OrdersListPage() {
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

  const columns = [
    {
      accessorKey: "orderNumber",
      header: "Order No.",
      cell: ({ row }: any) => (
        <Typography variant="body2" sx={{ fontWeight: 500 }}>{row.original.orderNumber}</Typography>
      ),
    },
    {
      accessorKey: "customer",
      header: "Customer",
      cell: ({ row }: any) => row.original.customer?.name || "—",
    },
    {
      accessorKey: "sourceQuotation",
      header: "From Quotation",
      cell: ({ row }: any) => row.original.sourceQuotation?.name || "—",
    },
    {
      accessorKey: "items",
      header: "Items",
      cell: ({ row }: any) => Array.isArray(row.original.items) ? row.original.items.length : 0,
    },
    {
      accessorKey: "linkedDocuments",
      header: "Linked",
      cell: ({ row }: any) => {
        const ld = row.original.linkedDocuments || {};
        const po = (ld.po || []).length;
        const dDocs = (ld.do || []).length;
        const inv = (ld.invoice || []).length;
        const total = po + dDocs + inv;
        if (total === 0) return <Typography variant="caption" color="text.disabled">—</Typography>;
        return (
          <Box sx={{ display: "flex", gap: 0.5 }}>
            {po > 0 && <Chip size="small" label={`${po} PO`} />}
            {dDocs > 0 && <Chip size="small" label={`${dDocs} DO`} />}
            {inv > 0 && <Chip size="small" label={`${inv} INV`} />}
          </Box>
        );
      },
    },
    {
      accessorKey: "status",
      header: "Status",
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
      cell: ({ row }: any) => moment(row.original.createdAt).format("DD/MM/YYYY"),
    },
    {
      accessorKey: "action",
      header: "Action",
      cell: ({ row }: any) => (
        <IconButton
          onClick={() => router.push(`/portal/orders/${row.original.id}`)}
          sx={{ color: "text.secondary", "&:hover": { color: "primary.main" } }}
        >
          <VisibilityIcon />
        </IconButton>
      ),
    },
  ];

  return (
    <MainCard>
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
