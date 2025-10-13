import React, { useState } from "react";
import { createColumnHelper } from "@tanstack/react-table";
import { Box, Button, Chip, Typography, IconButton } from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import VisibilityIcon from "@mui/icons-material/Visibility";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";

const columnHelper = createColumnHelper<any>();

export default function useOrganizationTableHeader() {
  const { getToken } = useAuth();
  const router = useRouter();
  const [editOrganizationOpen, setEditOrganizationOpen] = useState(false);
  const [selectedOrganization, setSelectedOrganization] = useState(null);
  const [organizationToDelete, setOrganizationToDelete] = useState<string | null>(null);
  const [isDeleteInProgress, setIsDeleteInProgress] = useState(false);

  const handleViewOrganization = (organizationId: string) => {
    router.push(`/portal/admin/organizations/${organizationId}`);
  };

  const handleEditOrganization = (organization: any) => {
    setSelectedOrganization(organization);
    setEditOrganizationOpen(true);
  };

  const handleCloseEditOrganization = () => {
    setEditOrganizationOpen(false);
    setSelectedOrganization(null);
  };

  const handleDeleteOrganization = async (organizationId: string) => {
    setOrganizationToDelete(organizationId);
  };

  const confirmDeleteOrganization = async () => {
    if (!organizationToDelete) return;
    setIsDeleteInProgress(true);

    try {
      const token = await getToken();
      if (!token) {
        throw new Error("No authentication token available");
      }

      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}/organizations/${organizationToDelete}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to delete organization");
      }

      console.log(`Organization ${organizationToDelete} deleted successfully`);
      return true;
    } catch (error) {
      console.error("Error deleting organization:", error);
      throw error;
    } finally {
      setIsDeleteInProgress(false);
      setOrganizationToDelete(null);
    }
  };

  const cancelDelete = () => {
    setOrganizationToDelete(null);
  };

  const columns = [
    columnHelper.accessor("name", {
      header: "Organization Name",
      cell: (info) => (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Typography variant="body2" sx={{ fontWeight: 500 }}>
            {info.getValue()}
          </Typography>
        </Box>
      ),
    }),
    columnHelper.accessor("id", {
      header: "Organization ID",
      cell: (info) => (
        <Typography variant="body2" sx={{ fontFamily: "monospace", fontSize: "0.8rem" }}>
          {info.getValue()}
        </Typography>
      ),
    }),
    columnHelper.accessor("_count.userOrganizations", {
      header: "Users",
      cell: (info) => <Chip label={info.getValue() || 0} size="small" variant="outlined" sx={{ fontSize: "0.75rem" }} />,
    }),
    columnHelper.accessor("_count.assets", {
      header: "Assets",
      cell: (info) => <Chip label={info.getValue() || 0} size="small" variant="outlined" sx={{ fontSize: "0.75rem" }} />,
    }),
    columnHelper.accessor("_count.documents", {
      header: "Documents",
      cell: (info) => <Chip label={info.getValue() || 0} size="small" variant="outlined" sx={{ fontSize: "0.75rem" }} />,
    }),
    columnHelper.accessor("_count.inventories", {
      header: "Inventory",
      cell: (info) => <Chip label={info.getValue() || 0} size="small" variant="outlined" sx={{ fontSize: "0.75rem" }} />,
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
          <IconButton size="small" onClick={() => handleViewOrganization(info.getValue())} sx={{ color: "info.main" }}>
            <VisibilityIcon fontSize="small" />
          </IconButton>
          <IconButton size="small" onClick={() => handleEditOrganization(info.row.original)} sx={{ color: "primary.main" }}>
            <EditIcon fontSize="small" />
          </IconButton>
          <IconButton size="small" onClick={() => handleDeleteOrganization(info.getValue())} sx={{ color: "error.main" }}>
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Box>
      ),
    }),
  ];

  return {
    columns,
    editOrganizationOpen,
    selectedOrganization,
    handleEditOrganization,
    handleCloseEditOrganization,
    organizationToDelete,
    isDeleteInProgress,
    confirmDeleteOrganization,
    cancelDelete,
  };
}
