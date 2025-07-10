import React, { useState } from "react";
import { createColumnHelper } from "@tanstack/react-table";
import { Avatar, IconButton, Typography, Chip, Box } from "@mui/material";
import VisibilityIcon from "@mui/icons-material/Visibility";
import DeleteIcon from "@mui/icons-material/Delete";
import DeleteItemDialogNoConfirm from "@/components/DeleteItemDialogNoConfirm";
import { useAuth } from "@clerk/nextjs";

const columnHelper = createColumnHelper<any>();

export default function useAssetsTableHeader() {
  const { getToken } = useAuth();
  const [assetToDelete, setAssetToDelete] = useState<string | null>(null);
  const [isDeleteInProgress, setIsDeleteInProgress] = useState(false);

  const handleViewAsset = (asset: any) => {
    // For admin view, we can navigate to the regular asset view
    window.open(`/portal/assets/${asset.skuKey}`, "_blank");
  };

  const handleDeleteAsset = async (assetId: string) => {
    setAssetToDelete(assetId);
  };

  const confirmDeleteAsset = async () => {
    if (!assetToDelete) return;
    setIsDeleteInProgress(true);

    try {
      const token = await getToken();
      if (!token) {
        throw new Error("No authentication token available");
      }

      // Note: Using regular assets endpoint for deletion since admin might not have delete
      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}/assets/${assetToDelete}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to delete asset");
      }

      console.log(`Asset ${assetToDelete} deleted successfully`);
      // Note: Would need to trigger refresh of the assets list here
      return true;
    } catch (error) {
      console.error("Error deleting asset:", error);
      throw error;
    } finally {
      setIsDeleteInProgress(false);
      setAssetToDelete(null);
    }
  };

  const cancelDelete = () => {
    setAssetToDelete(null);
  };

  const columns = [
    columnHelper.accessor("skuKey", {
      header: "SKU-Key",
      cell: (info) => (
        <Typography variant="body2" sx={{ fontFamily: "monospace", fontSize: "0.8rem" }}>
          {info.getValue()}
        </Typography>
      ),
    }),
    columnHelper.accessor("name", {
      header: "Asset Name",
      cell: (info) => (
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          {info.getValue()}
        </Typography>
      ),
    }),
    columnHelper.accessor("image", {
      header: "Image",
      cell: (info) => {
        const imageUrl = info.getValue();
        return <Avatar src={`${process.env.NEXT_PUBLIC_RESOURCE_URL}${imageUrl}`} alt="Asset Image" sx={{ borderRadius: "0.4rem", width: 50, height: 50 }} />;
      },
    }),
    columnHelper.accessor("organization.name", {
      header: "Organization",
      cell: (info) => <Chip label={info.getValue() || "Unknown"} size="small" variant="outlined" sx={{ fontSize: "0.75rem" }} />,
    }),
    columnHelper.accessor("category.name", {
      header: "Category",
      cell: (info) => <Typography variant="body2">{info.getValue() || "Uncategorized"}</Typography>,
    }),
    columnHelper.accessor("instockInventoryCount", {
      header: "In Stock",
      cell: (info) => <Chip label={info.getValue() || 0} size="small" color="primary" sx={{ fontSize: "0.75rem" }} />,
    }),
    columnHelper.accessor("status", {
      header: "Status",
      cell: (info) => {
        const status = info.getValue();
        const getStatusColor = (status: string) => {
          switch (status) {
            case "instock":
              return "success";
            case "rental":
              return "primary";
            case "reserved":
              return "warning";
            case "maintenance":
              return "secondary";
            case "sold":
              return "error";
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
          <IconButton size="small" onClick={() => handleViewAsset(info.row.original)} sx={{ color: "primary.main" }}>
            <VisibilityIcon fontSize="small" />
          </IconButton>
          <IconButton size="small" onClick={() => handleDeleteAsset(info.getValue())} sx={{ color: "error.main" }}>
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Box>
      ),
    }),
  ];

  const deleteDialog = <DeleteItemDialogNoConfirm open={!!assetToDelete} onConfirm={confirmDeleteAsset} onCancel={cancelDelete} loading={isDeleteInProgress} />;

  return {
    columns,
    deleteDialog,
  };
}
