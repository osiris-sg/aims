"use client";

import React, { useState } from "react";
import { useGetCustomers, useDeleteCustomer } from "@/app/portal/hooks/api";
import MainCard from "@/components/MainCard";
import PageTable from "@/components/PageTable";
import DeleteItemDialogNoConfirm from "@/components/DeleteItemDialogNoConfirm";
import { Box, IconButton } from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import VisibilityIcon from "@mui/icons-material/Visibility";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/routes";
import AddCustomer from "./components/AddCustomer";

interface Customer {
  id: string;
  customerCode: string;
  name: string;
  email: string;
  phone: string;
  address: string;
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
  [key: string]: any;
}

export default function CustomersPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Filters>({
    createdOn: {
      startDate: null,
      endDate: null,
    },
  });
  const [customerToDelete, setCustomerToDelete] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | undefined>();
  const [isEditMode, setIsEditMode] = useState(false);

  // Fetch customers with new hook
  const { customers = [], total = 0, isLoading, refetch } = useGetCustomers({ page, limit, search, filters });

  // Delete customer mutation
  const deleteCustomerMutation = useDeleteCustomer();

  const columns = [
    {
      id: "customerCode",
      accessorKey: "customerCode",
      header: "Customer Code",
      cell: (info: any) => info.getValue() || "-",
    },
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
    {
      id: "actions",
      header: "Actions",
      cell: (info: any) => {
        const customer = info.row.original;
        return (
          <Box display="flex" gap={1}>
            <IconButton
              onClick={() => router.push(`${ROUTES.CUSTOMERS}/${customer.id}`)}
              sx={{
                color: "text.secondary",
                "&:hover": { color: "primary.main" },
              }}
            >
              <VisibilityIcon />
            </IconButton>
            <IconButton
              onClick={() => handleEditCustomer(customer.id)}
              sx={{
                color: "text.secondary",
                "&:hover": { color: "info.main" },
              }}
            >
              <EditIcon />
            </IconButton>
            <IconButton
              onClick={() => setCustomerToDelete(customer.id)}
              sx={{
                color: "text.secondary",
                "&:hover": { color: "error.main" },
              }}
            >
              <DeleteIcon />
            </IconButton>
          </Box>
        );
      },
    },
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
        availableFilters={["createdOn"]}
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
