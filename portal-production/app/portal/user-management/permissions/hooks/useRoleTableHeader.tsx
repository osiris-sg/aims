import React, { useState } from "react";
import { createColumnHelper } from "@tanstack/react-table";
import { Box, Button, Chip, Typography, IconButton } from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";

const columnHelper = createColumnHelper<any>();

export default function useRoleTableHeader() {
  const [editPermissionsOpen, setEditPermissionsOpen] = useState(false);
  const [selectedRole, setSelectedRole] = useState(null);

  const handleEditPermissions = (role: any) => {
    setSelectedRole(role);
    setEditPermissionsOpen(true);
  };

  const handleCloseEditPermissions = () => setEditPermissionsOpen(false);

  const handleDeleteRole = async (id: string) => {
    // Implement delete logic here
    const confirmed = window.confirm("Are you sure you want to delete this role?");
    if (confirmed) {
      try {
        // API call to delete role
        console.log(`Deleting role with id: ${id}`);
        // Refresh the roles list after successful deletion
      } catch (error) {
        console.error("Error deleting role:", error);
      }
    }
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
        return <Chip label={permissions ? permissions.length : 0} size="small" color="primary" sx={{ borderRadius: "4px" }} />;
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
            <IconButton size="small" color="primary" onClick={() => handleEditPermissions(role)}>
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
    editPermissionsOpen,
    setEditPermissionsOpen,
    selectedRole,
    handleCloseEditPermissions,
  };
}
