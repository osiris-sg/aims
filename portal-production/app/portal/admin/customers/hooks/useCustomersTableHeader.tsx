import React, { useState } from "react";
import { createColumnHelper } from "@tanstack/react-table";
import { Typography, Chip } from "@mui/material";
import { kebabColumn } from "@/components/RowKebab";
import DeleteItemDialogNoConfirm from "@/components/DeleteItemDialogNoConfirm";
import { useAuth } from "@clerk/nextjs";

const columnHelper = createColumnHelper<any>();

export default function useCustomersTableHeader() {
  const { getToken } = useAuth();
  const [customerToDelete, setCustomerToDelete] = useState<string | null>(null);
  const [isDeleteInProgress, setIsDeleteInProgress] = useState(false);

  const handleViewCustomer = (customer: any) => {
    window.open(`/portal/customers/${customer.id}`, "_blank");
  };

  const handleDeleteCustomer = async (customerId: string) => {
    setCustomerToDelete(customerId);
  };

  const confirmDeleteCustomer = async () => {
    if (!customerToDelete) return;
    setIsDeleteInProgress(true);

    try {
      const token = await getToken();
      if (!token) {
        throw new Error("No authentication token available");
      }

      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}/customers/${customerToDelete}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to delete customer");
      }

      console.log(`Customer ${customerToDelete} deleted successfully`);
      return true;
    } catch (error) {
      console.error("Error deleting customer:", error);
      throw error;
    } finally {
      setIsDeleteInProgress(false);
      setCustomerToDelete(null);
    }
  };

  const cancelDelete = () => {
    setCustomerToDelete(null);
  };

  const columns = [
    columnHelper.accessor("name", {
      header: "Customer Name",
      cell: (info) => (
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          {info.getValue()}
        </Typography>
      ),
    }),
    columnHelper.accessor("email", {
      header: "Email",
      cell: (info) => (
        <Typography variant="body2" sx={{ fontSize: "0.8rem" }}>
          {info.getValue()}
        </Typography>
      ),
    }),
    columnHelper.accessor("phone", {
      header: "Phone",
      cell: (info) => (
        <Typography variant="body2" sx={{ fontSize: "0.8rem" }}>
          {info.getValue() || "N/A"}
        </Typography>
      ),
    }),
    columnHelper.accessor("organization.name", {
      header: "Organization",
      cell: (info) => <Chip label={info.getValue() || "Unknown"} size="small" variant="outlined" sx={{ fontSize: "0.75rem" }} />,
    }),
    columnHelper.accessor("address", {
      header: "Address",
      cell: (info) => (
        <Typography variant="body2" sx={{ fontSize: "0.8rem", maxWidth: 200, whiteSpace: "normal", wordBreak: "break-word" }}>
          {info.getValue() || "N/A"}
        </Typography>
      ),
    }),
    columnHelper.accessor("createdAt", {
      header: "Created",
      cell: (info) => (
        <Typography variant="body2" sx={{ fontSize: "0.8rem" }}>
          {new Date(info.getValue()).toLocaleDateString()}
        </Typography>
      ),
    }),
    kebabColumn((row: any) => [
      { label: "Open", onClick: () => handleViewCustomer(row) },
      { label: "Delete", destructive: true, onClick: () => handleDeleteCustomer(row.id) },
    ]),
  ];

  const deleteDialog = <DeleteItemDialogNoConfirm open={!!customerToDelete} onConfirm={confirmDeleteCustomer} onCancel={cancelDelete} loading={isDeleteInProgress} />;

  return {
    columns,
    deleteDialog,
    handleViewCustomer,
  };
}
