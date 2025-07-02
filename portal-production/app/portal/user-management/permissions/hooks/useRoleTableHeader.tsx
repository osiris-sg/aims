import React, { useState } from "react";
import { createColumnHelper } from "@tanstack/react-table";
import { Box, Button, Chip, Typography, IconButton } from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import { useAuth } from "@clerk/nextjs";

const columnHelper = createColumnHelper<any>();

export default function useRoleTableHeader() {
  const { getToken } = useAuth();
  const [editRoleOpen, setEditRoleOpen] = useState(false);
  const [selectedRole, setSelectedRole] = useState(null);
  const [roleToDelete, setRoleToDelete] = useState<string | null>(null);
  const [isDeleteInProgress, setIsDeleteInProgress] = useState(false);

  const handleEditRole = (role: any) => {
    setSelectedRole(role);
    setEditRoleOpen(true);
  };

  const handleCloseEditRole = () => {
    setEditRoleOpen(false);
    setSelectedRole(null);
  };

  const handleDeleteRole = async (roleId: string) => {
    setRoleToDelete(roleId);
  };

  const confirmDeleteRole = async () => {
    if (!roleToDelete) return;
    setIsDeleteInProgress(true);

    try {
      const token = await getToken();
      if (!token) {
        throw new Error("No authentication token available");
      }

      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}/roles/${roleToDelete}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to delete role");
      }

      console.log(`Role ${roleToDelete} deleted successfully`);
      return true;
    } catch (error) {
      console.error("Error deleting role:", error);
      throw error;
    } finally {
      setIsDeleteInProgress(false);
      setRoleToDelete(null);
    }
  };

  const cancelDelete = () => {
    setRoleToDelete(null);
  };

  const columns = [
    columnHelper.accessor("name", {
      header: "Role Name",
      cell: (info) => (
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          {info.getValue()}
        </Typography>
      ),
    }),
    columnHelper.accessor("description", {
      header: "Description",
      cell: (info) => info.getValue(),
    }),
    columnHelper.accessor("permissions", {
      header: "Permissions Count",
      cell: (info) => {
        const permissions = info.getValue();
        const count = Array.isArray(permissions) ? permissions.length : 0;
        return <Chip label={`${count} permissions`} size="small" color="secondary" sx={{ borderRadius: "4px" }} />;
      },
    }),
    columnHelper.accessor("createdAt", {
      header: "Created",
      cell: (info) => new Date(info.getValue()).toLocaleDateString(),
    }),
    columnHelper.accessor("id", {
      header: "Actions",
      cell: (info) => {
        const role = info.row.original;
        return (
          <Box sx={{ display: "flex", gap: 1 }}>
            <IconButton size="small" color="primary" onClick={() => handleEditRole(role)}>
              <EditIcon fontSize="small" />
            </IconButton>
            <IconButton size="small" color="error" onClick={() => handleDeleteRole(info.getValue())}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Box>
        );
      },
    }),
  ];

  return {
    columns,
    editRoleOpen,
    selectedRole,
    handleCloseEditRole,
    roleToDelete,
    isDeleteInProgress,
    confirmDeleteRole,
    cancelDelete,
  };
}
