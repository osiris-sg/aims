import React, { useState } from "react";
import { createColumnHelper } from "@tanstack/react-table";
import { Box, Button, Chip, Typography, IconButton, Avatar } from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import PersonIcon from "@mui/icons-material/Person";

const columnHelper = createColumnHelper<any>();

export default function useUserTableHeader() {
  const [editUserOpen, setEditUserOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);

  const handleEditUser = (user: any) => {
    setSelectedUser(user);
    setEditUserOpen(true);
  };

  const handleCloseEditUser = () => setEditUserOpen(false);

  const handleDeleteUser = async (id: string) => {
    // Implement delete logic here
    const confirmed = window.confirm("Are you sure you want to delete this user?");
    if (confirmed) {
      try {
        // API call to delete user
        console.log(`Deleting user with id: ${id}`);
        // Refresh the users list after successful deletion
      } catch (error) {
        console.error("Error deleting user:", error);
      }
    }
  };

  const columns = [
    columnHelper.accessor("name", {
      header: "User",
      cell: (info) => {
        const user = info.row.original;
        console.log("user", user);
        return (
          <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
            <Avatar sx={{ width: 32, height: 32, bgcolor: "primary.main" }}>
              <PersonIcon fontSize="small" />
            </Avatar>
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                {user.email}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {user.name}
              </Typography>
            </Box>
          </Box>
        );
      },
    }),
    columnHelper.accessor("roles", {
      header: "Roles",
      cell: (info) => {
        const roles = info.getValue();
        return (
          <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
            {roles && roles.length > 0 ? (
              roles.map((role: any, index: number) => (
                <Chip
                  key={role.id}
                  label={role.name}
                  size="small"
                  color="primary"
                  variant="outlined"
                  sx={{
                    borderRadius: "4px",
                    fontSize: "0.75rem",
                    height: "24px",
                  }}
                />
              ))
            ) : (
              <Typography variant="caption" color="text.secondary">
                No roles assigned
              </Typography>
            )}
          </Box>
        );
      },
    }),
    columnHelper.accessor(
      (row) => {
        const roles = row.roles;
        return (
          roles?.reduce((total: number, role: any) => {
            return total + (role.permissions?.length || 0);
          }, 0) || 0
        );
      },
      {
        id: "permissions",
        header: "Permissions",
        cell: (info) => {
          const totalPermissions = info.getValue();
          return <Chip label={`${totalPermissions} permissions`} size="small" color="secondary" sx={{ borderRadius: "4px" }} />;
        },
      }
    ),
    columnHelper.accessor("createdAt", {
      header: "Created",
      cell: (info) => {
        return <Typography variant="body2">{new Date(info.getValue()).toLocaleDateString()}</Typography>;
      },
    }),
    columnHelper.accessor("id", {
      header: "Actions",
      cell: (info) => {
        const user = info.row.original;
        return (
          <Box sx={{ display: "flex", gap: 1 }}>
            <IconButton size="small" color="primary" onClick={() => handleEditUser(user)} title="Edit user">
              <EditIcon fontSize="small" />
            </IconButton>
            <IconButton size="small" color="error" onClick={() => handleDeleteUser(info.getValue())} title="Delete user">
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Box>
        );
      },
    }),
  ];

  return {
    columns,
    editUserOpen,
    setEditUserOpen,
    selectedUser,
    handleCloseEditUser,
  };
}
