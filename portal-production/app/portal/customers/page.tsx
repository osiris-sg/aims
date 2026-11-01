"use client";

import React, { useMemo, useState } from "react";
import { useGetCustomers, useDeleteCustomer } from "@/app/portal/hooks/api";
import MainCard from "@/components/MainCard";
import { kebabColumn } from "@/components/RowKebab";
import PageTable from "@/components/PageTable";
import type { FilterField } from "@/components/FilterDrawer";
import DeleteItemDialogNoConfirm from "@/components/DeleteItemDialogNoConfirm";
import { Box, IconButton } from "@mui/material";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/routes";
import AddCustomer from "./components/AddCustomer";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";

interface Customer {
  id: string;
  customerCode: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  uen?: string | null;
  externalRef?: string | null;
  createdAt: string;
  salesman?: {
    id: string;
    salesmanCode: string;
    userId: string;
    name: string;
  } | null;
}

interface Filters {
  createdOn?: {
    startDate: string | null;
    endDate: string | null;
  };
  salesmanId?: string;
  [key: string]: any;
}

export default function CustomersPage() {
  const router = useRouter();
  // UEN + Old code columns (enableCustomerUen); the search finds both for every org.
  const { isCustomerUenEnabled } = useOrganizationFeatures();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Filters>({
    createdOn: {
      startDate: null,
      endDate: null,
    },
    salesmanId: "",
  });
  const [customerToDelete, setCustomerToDelete] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | undefined>();
  const [isEditMode, setIsEditMode] = useState(false);

  // Both createdOn and salesmanId are applied server-side so filters span all
  // pages (not just the current one) and counts stay consistent.
  const apiFilters = useMemo(
    () => ({ createdOn: filters.createdOn, salesmanId: filters.salesmanId || undefined }),
    [filters.createdOn, filters.salesmanId],
  );

  // Fetch customers with new hook (server already applied the filters).
  const { customers = [], total = 0, isLoading, refetch } = useGetCustomers({ page, limit, search, filters: apiFilters });

  // Salesman filter options from the org's salesmen (stable across filtered
  // pages). Used to be derived from the first 1000 customers, which missed
  // salesmen of the rest in orgs with thousands of customers.
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const { data: salesmen = [] } = useQuery({
    queryKey: ["customer-salesmen", organization?.id],
    enabled: !!organization?.id,
    staleTime: 60_000,
    queryFn: async () => {
      const token = await getToken();
      const res = await request({ path: "/customers/salesmen", method: "GET" }, {}, token || undefined);
      const list = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : [];
      return list as { id: string; name?: string; salesmanCode?: string }[];
    },
  });
  const salesmenOptions = useMemo(
    () =>
      salesmen
        .filter((s) => s?.id)
        .map((s) => {
          const name = s.name || s.salesmanCode || "Salesman";
          return { value: s.id, label: s.salesmanCode && s.salesmanCode !== name ? `${name} (${s.salesmanCode})` : name };
        }),
    [salesmen],
  );

  const filterConfig: FilterField[] = useMemo(
    () => [
      { type: "dateRange", key: "createdOn", label: "Created On" },
      { type: "select", key: "salesmanId", label: "Salesman", options: salesmenOptions },
    ],
    [salesmenOptions],
  );

  // Delete customer mutation
  const deleteCustomerMutation = useDeleteCustomer();

  const columns = [
    {
      id: "customerCode",
      accessorKey: "customerCode",
      header: "Customer Code",
      cell: (info: any) => info.getValue() || "-",
    },
    ...(isCustomerUenEnabled
      ? [
          { id: "uen", accessorKey: "uen", header: "UEN", cell: (info: any) => info.getValue() || "-" },
          { id: "externalRef", accessorKey: "externalRef", header: "Old code", cell: (info: any) => info.getValue() || "-" },
        ]
      : []),
    {
      id: "name",
      accessorKey: "name",
      header: "Name",
      cell: (info: any) => info.getValue(),
    },
    {
      id: "email",
      accessorKey: "email",
      header: "Email",
      cell: (info: any) => info.getValue(),
    },
    {
      id: "phone",
      accessorKey: "phone",
      header: "Phone",
      cell: (info: any) => info.getValue(),
    },
    {
      id: "address",
      accessorKey: "address",
      header: "Address",
      cell: (info: any) => info.getValue(),
    },
    {
      id: "salesman",
      accessorKey: "salesman",
      header: "Salesman",
      cell: (info: any) => {
        const salesman = info.getValue();
        if (!salesman) return "-";
        return `${salesman.name} (${salesman.salesmanCode})`;
      },
    },
    {
      id: "createdAt",
      accessorKey: "createdAt",
      header: "Created At",
      cell: (info: any) => {
        const value = info.getValue();
        return value ? new Date(value).toLocaleDateString() : "";
      },
    },
    kebabColumn((customer: any) => [
      { label: "Open", onClick: () => router.push(`${ROUTES.CUSTOMERS}/${customer.id}`) },
      { label: "Edit", onClick: () => handleEditCustomer(customer.id) },
      { label: "Delete", destructive: true, onClick: () => setCustomerToDelete(customer.id) },
    ]),
  ];

  const handleDelete = async () => {
    if (!customerToDelete) return;

    try {
      await deleteCustomerMutation.mutateAsync(customerToDelete);
      setCustomerToDelete(null);
      refetch();
    } catch (error) {
      console.error("Error deleting customer:", error);
    }
  };

  const handleAddCustomer = () => {
    setSelectedCustomerId(undefined);
    setIsEditMode(false);
    setIsDrawerOpen(true);
  };

  const handleEditCustomer = (customerId: string) => {
    setSelectedCustomerId(customerId);
    setIsEditMode(true);
    setIsDrawerOpen(true);
  };

  const handleCloseDrawer = () => {
    setIsDrawerOpen(false);
    setSelectedCustomerId(undefined);
    setIsEditMode(false);
  };

  return (
    <MainCard>
      <PageTable
        onRowClick={(r: any) => router.push(`${ROUTES.CUSTOMERS}/${r.id}`)}
        columns={columns}
        data={customers}
        tableName="Customers List"
        subTitle="Customers Detail Information"
        buttonName="Add Customer"
        onAddClick={handleAddCustomer}
        loading={isLoading}
        page={page}
        limit={limit}
        search={search}
        filters={filters}
        setPage={setPage}
        setLimit={setLimit}
        setSearch={setSearch}
        setFilters={setFilters}
        filterConfig={filterConfig}
        pageCount={Math.ceil(total / limit)}
        totalDocs={total}
      />

      <DeleteItemDialogNoConfirm
        open={!!customerToDelete}
        onCancel={() => setCustomerToDelete(null)}
        onConfirm={handleDelete}
        loading={deleteCustomerMutation.isPending}
      />

      <AddCustomer
        open={isDrawerOpen}
        onClose={handleCloseDrawer}
        onSuccess={refetch}
        customerId={selectedCustomerId}
        isEditMode={isEditMode}
      />
    </MainCard>
  );
}
