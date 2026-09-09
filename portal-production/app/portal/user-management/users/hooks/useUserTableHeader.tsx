import React, { useState } from "react";
import { createColumnHelper } from "@tanstack/react-table";
import { Box, Chip, Typography, Avatar } from "@mui/material";
import PersonIcon from "@mui/icons-material/Person";
import { kebabColumn } from "@/components/RowKebab";
import { request } from "@/helpers/request";
import { useAuth } from "@clerk/nextjs";

const columnHelper = createColumnHelper<any>();

export default function useUserTableHeader() {
  const [editUserOpen, setEditUserOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [userToDelete, setUserToDelete] = useState<string | null>(null);
  const [isDeleteInProgress, setIsDeleteInProgress] = useState(false);
  const { getToken } = useAuth();

  const handleEditUser = (user: any) => {
    setSelectedUser(user);
    setEditUserOpen(true);
  };

  const handleCloseEditUser = () => setEditUserOpen(false);

  const handleDeleteUser = async (userId: string) => {
    setUserToDelete(userId);
  };

  const confirmDeleteUser = async () => {
    if (!userToDelete) return;
    setIsDeleteInProgress(true);

    try {
      const token = await getToken();
      if (!token) {
        throw new Error("No authentication token available");
      }

      const response = await request(
        {
          path: `/users/${userToDelete}`,
          method: "DELETE",
        },
        {},
        token
      );

      if (response.success) {
        console.log(`User ${userToDelete} deleted successfully`);
        // The parent component should handle refreshing the users list
        return true;
      } else {
        throw new Error(response.message || "Failed to delete user");
      }
    } catch (error) {
      console.error("Error deleting user:", error);
      throw error;
    } finally {
      setIsDeleteInProgress(false);
      setUserToDelete(null);
    }
  };

  const cancelDelete = () => {
    setUserToDelete(null);
  };

  const columns = [
    columnHelper.accessor("name", {
      header: "User",
      cell: (info) => {
        const user = info.row.original;
        return (
          <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
            <Avatar sx={{ width: 32, height: 32 }}>
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
          return <Chip label={`${totalPermissions} permissions`} size="small" variant="outlined" sx={{ borderRadius: "4px" }} />;
        },
      }
    ),
    columnHelper.accessor("createdAt", {
      header: "Created",
      cell: (info) => {
        return <Typography variant="body2">{new Date(info.getValue()).toLocaleDateString()}</Typography>;
      },
    }),
    kebabColumn((row: any) => [
      { label: "Edit", onClick: () => handleEditUser(row) },
      { label: "Delete", destructive: true, onClick: () => handleDeleteUser(row.id) },
    ]),
  ];

  return {
    columns,
    handleEditUser,
    editUserOpen,
    setEditUserOpen,
    selectedUser,
    handleCloseEditUser,
    userToDelete,
    isDeleteInProgress,
    confirmDeleteUser,
    cancelDelete,
  };
}
