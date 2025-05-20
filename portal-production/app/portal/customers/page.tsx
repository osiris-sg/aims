"use client";

import React, { useState, useEffect } from "react";
import { useOrganization, useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";
import MainCard from "@/components/MainCard";
import PageTable from "@/components/PageTable";
import DeleteItemDialogNoConfirm from "@/components/DeleteItemDialogNoConfirm";
import { Box, IconButton, Typography } from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import VisibilityIcon from "@mui/icons-material/Visibility";
import { useRouter } from "next/navigation";
import AddCustomer from "./components/AddCustomer";

interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  createdAt: string;
}

interface PaginatedResponse {
  docs: Customer[];
  totalDocs: number;
  limit: number;
  totalPages: number;
  page: number;
  pagingCounter: number;
  hasPrevPage: boolean;
  hasNextPage: boolean;
  prevPage: number | null;
  nextPage: number | null;
}

interface Filters {
  createdOn?: {
    startDate: string | null;
    endDate: string | null;
  };
  [key: string]: any;
}

interface CustomerFormData {
  name: string;
  email: string;
  phone: string;
  address: string;
}

export default function CustomersPage() {
  const router = useRouter();
  const { organization } = useOrganization();
  const { getToken } = useAuth();
  const organizationId = organization?.id;

  const [customers, setCustomers] = useState<PaginatedResponse>({
    docs: [],
    totalDocs: 0,
    limit: 10,
    totalPages: 0,
    page: 1,
    pagingCounter: 0,
    hasPrevPage: false,
    hasNextPage: false,
    prevPage: null,
    nextPage: null,
  });
  const [loading, setLoading] = useState(false);
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
  const [isDeleteInProgress, setIsDeleteInProgress] = useState(false);
  const [openDrawer, setOpenDrawer] = useState(false);

  const columns = [
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
              onClick={() => router.push(`/customers/${customer.id}`)}
              sx={{
                borderRadius: "8px",
                color: "primary.contrastText",
                bgcolor: "primary.main",
                "&:hover": { bgcolor: "primary.dark" },
              }}
            >
              <VisibilityIcon />
            </IconButton>
            <IconButton
              onClick={() => router.push(`/customers/${customer.id}/edit`)}
              sx={{
                borderRadius: "8px",
                color: "secondary.contrastText",
                bgcolor: "secondary.main",
                "&:hover": { bgcolor: "secondary.dark" },
              }}
            >
              <EditIcon />
            </IconButton>
            <IconButton
              onClick={() => setCustomerToDelete(customer.id)}
              sx={{
                borderRadius: "8px",
                color: "error.contrastText",
                bgcolor: "error.main",
                "&:hover": { bgcolor: "error.dark" },
              }}
            >
              <DeleteIcon />
            </IconButton>
          </Box>
        );
      },
    },
  ];

  const fetchCustomers = async () => {
    if (!organizationId) return;
    setLoading(true);

    try {
      const token = await getToken();
      if (!token) return;

      const response = await request(
        {
          path: "/customers",
          method: "POST",
        },
        {
          page,
          limit,
          search,
          filters,
          organizationId,
        },
        token
      );

      if (response.success) {
        setCustomers(response.data);
      }
    } catch (error) {
      console.error("Error fetching customers:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!organizationId || !customerToDelete) return;
    setIsDeleteInProgress(true);

    try {
      const token = await getToken();
      if (!token) return;

      const response = await request(
        {
          path: `/customers/${customerToDelete}`,
          method: "DELETE",
        },
        {},
        token
      );

      if (response.success) {
        fetchCustomers();
      }
    } catch (error) {
      console.error("Error deleting customer:", error);
    } finally {
      setIsDeleteInProgress(false);
      setCustomerToDelete(null);
    }
  };

  useEffect(() => {
    fetchCustomers();
  }, [organizationId, page, limit, search, filters]);

  return (
    <MainCard>
      <PageTable
        columns={columns}
        data={customers.docs}
        tableName="Customers List"
        subTitle="Customers Detail Information"
        buttonName="Add Customer"
        onAddClick={() => setOpenDrawer(true)}
        loading={loading}
        page={page}
        limit={limit}
        search={search}
        filters={filters}
        setPage={setPage}
        setLimit={setLimit}
        setSearch={setSearch}
        setFilters={setFilters}
        availableFilters={["createdOn"]}
        pageCount={customers.totalPages}
        totalDocs={customers.totalDocs}
      />
      <DeleteItemDialogNoConfirm open={!!customerToDelete} onCancel={() => setCustomerToDelete(null)} onConfirm={handleDelete} loading={isDeleteInProgress} />
      <AddCustomer open={openDrawer} onClose={() => setOpenDrawer(false)} onSuccess={fetchCustomers} />
    </MainCard>
  );
}
