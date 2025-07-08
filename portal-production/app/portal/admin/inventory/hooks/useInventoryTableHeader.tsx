import React, { useState } from "react";
import { createColumnHelper } from "@tanstack/react-table";
import { IconButton, Typography, Chip, Box } from "@mui/material";
import VisibilityIcon from "@mui/icons-material/Visibility";
import DeleteIcon from "@mui/icons-material/Delete";
import DeleteItemDialogNoConfirm from "@/components/DeleteItemDialogNoConfirm";
import { useAuth } from "@clerk/nextjs";

const columnHelper = createColumnHelper<any>();

export default function useInventoryTableHeader() {
  const { getToken } = useAuth();
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);
  const [isDeleteInProgress, setIsDeleteInProgress] = useState(false);

  const handleViewItem = (item: any) => {
    window.open(`/portal/inventory/${item.id}`, "_blank");
  };

  const handleDeleteItem = async (itemId: string) => {
    setItemToDelete(itemId);
  };

  const confirmDeleteItem = async () => {
    if (!itemToDelete) return;
    setIsDeleteInProgress(true);

    try {
      const token = await getToken();
      if (!token) {
        throw new Error("No authentication token available");
      }

      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}/inventories/${itemToDelete}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to delete inventory item");
      }

      console.log(`Inventory item ${itemToDelete} deleted successfully`);
      return true;
    } catch (error) {
      console.error("Error deleting inventory item:", error);
      throw error;
    } finally {
      setIsDeleteInProgress(false);
      setItemToDelete(null);
    }
  };

  const cancelDelete = () => {
    setItemToDelete(null);
  };

  const columns = [
    columnHelper.accessor("sku", {
      header: "SKU",
      cell: (info) => (
        <Typography variant="body2" sx={{ fontFamily: "monospace", fontSize: "0.8rem" }}>
          {info.getValue()}
        </Typography>
      ),
    }),
    columnHelper.accessor("asset.name", {
      header: "Asset Name",
      cell: (info) => (
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          {info.getValue() || "N/A"}
        </Typography>
      ),
    }),
    columnHelper.accessor("organization.name", {
      header: "Organization",
      cell: (info) => <Chip label={info.getValue() || "Unknown"} size="small" variant="outlined" sx={{ fontSize: "0.75rem" }} />,
    }),
    columnHelper.accessor("quantity", {
      header: "Total Qty",
      cell: (info) => <Chip label={info.getValue() || 0} size="small" color="primary" sx={{ fontSize: "0.75rem" }} />,
    }),
    columnHelper.accessor("available", {
      header: "Available",
      cell: (info) => <Chip label={info.getValue() || 0} size="small" color="success" sx={{ fontSize: "0.75rem" }} />,
    }),
    columnHelper.accessor("reserved", {
      header: "Reserved",
      cell: (info) => <Chip label={info.getValue() || 0} size="small" color="warning" sx={{ fontSize: "0.75rem" }} />,
    }),
    columnHelper.accessor("status", {
      header: "Status",
      cell: (info) => {
        const status = info.getValue();
        const getStatusColor = (status: string) => {
          switch (status) {
            case "instock":
              return "success";
            case "outofstock":
              return "error";
            case "lowstock":
              return "warning";
            default:
              return "default";
          }
        };

        return <Chip label={status || "Unknown"} size="small" color={getStatusColor(status) as any} sx={{ fontSize: "0.75rem" }} />;
      },
    }),
    columnHelper.accessor("createdAt", {
      header: "Created",
      cell: (info) => (
        <Typography variant="body2" sx={{ fontSize: "0.8rem" }}>
          {new Date(info.getValue()).toLocaleDateString()}
        </Typography>
      ),
    }),
    columnHelper.accessor("id", {
      id: "actions",
      header: "Actions",
      cell: (info) => (
        <Box sx={{ display: "flex", gap: 1 }}>
          <IconButton size="small" onClick={() => handleViewItem(info.row.original)} sx={{ color: "primary.main" }}>
            <VisibilityIcon fontSize="small" />
          </IconButton>
          <IconButton size="small" onClick={() => handleDeleteItem(info.getValue())} sx={{ color: "error.main" }}>
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Box>
      ),
    }),
  ];

  const deleteDialog = <DeleteItemDialogNoConfirm open={!!itemToDelete} onConfirm={confirmDeleteItem} onCancel={cancelDelete} loading={isDeleteInProgress} />;

  return {
    columns,
    deleteDialog,
  };
}
