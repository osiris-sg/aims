import React, { useState } from "react";
import { createColumnHelper } from "@tanstack/react-table";
import { Box, Button, Chip, Typography, IconButton, Avatar } from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import PersonIcon from "@mui/icons-material/Person";
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
    columnHelper.accessor("userId", {
      header: "User",
      cell: (info) => {
        const userRecord = info.row.original;
        const clerkUser = userRecord.clerkUser;
        console.log("🔍 User record data:", userRecord); // Debug log

        // Get user display name
        const firstName = clerkUser?.firstName;
        const lastName = clerkUser?.lastName;
        const email = clerkUser?.emailAddresses?.[0]?.emailAddress;
        const displayName = firstName && lastName ? `${firstName} ${lastName}` : firstName || lastName || email || userRecord.userId;

        return (
          <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
            <Avatar src={clerkUser?.imageUrl} sx={{ width: 32, height: 32, bgcolor: "primary.main" }}>
              {!clerkUser?.imageUrl && <PersonIcon fontSize="small" />}
            </Avatar>
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                {displayName}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {email && email !== displayName ? email : `ID: ${userRecord.userId?.slice(-8) || "N/A"}`} • {userRecord.isActive ? "Active" : "Inactive"}
              </Typography>
            </Box>
          </Box>
        );
      },
    }),
    columnHelper.accessor("roles", {
      header: "Roles",
      cell: (info) => {
        const roles = info.getValue() || [];
        console.log("🔍 Roles data:", roles); // Debug log
        return (
          <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
            {roles && roles.length > 0 ? (
              roles.map((role: any, index: number) => (
                <Chip
                  key={role.id || index}
                  label={role.name || "Unknown Role"}
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
    columnHelper.accessor("permissions", {
      header: "Permissions",
      cell: (info) => {
        const permissions = info.getValue() || [];
        console.log("🔍 Permissions data:", permissions); // Debug log
        const uniquePermissions = permissions.filter((perm: any, index: number, self: any[]) => index === self.findIndex((p: any) => p.id === perm.id));

        return (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Chip label={`${uniquePermissions.length} permissions`} size="small" color="secondary" sx={{ borderRadius: "4px" }} />
            {uniquePermissions.length > 0 && (
              <Typography variant="caption" color="text.secondary" title={uniquePermissions.map((p: any) => p.name).join(", ")}>
                (
                {uniquePermissions
                  .slice(0, 2)
                  .map((p: any) => p.resource)
                  .join(", ")}
                {uniquePermissions.length > 2 ? "..." : ""})
              </Typography>
            )}
          </Box>
        );
      },
    }),
    columnHelper.accessor("organization", {
      header: "Organization",
      cell: (info) => {
        const userRecord = info.row.original;
        const organization = userRecord.organization;
        console.log("🔍 Organization data:", organization); // Debug log
        console.log("🔍 Full user record:", userRecord); // Debug log

        return (
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 500 }}>
              {organization?.name || userRecord.organizationId || "No Organization"}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Joined: {userRecord.joinedAt ? new Date(userRecord.joinedAt).toLocaleDateString() : "Unknown"}
            </Typography>
          </Box>
        );
      },
    }),
    columnHelper.accessor("id", {
      header: "Actions",
      cell: (info) => {
        const userRecord = info.row.original;
        return (
          <Box sx={{ display: "flex", gap: 1 }}>
            <IconButton
              size="small"
              onClick={() => handleEditUser(userRecord)}
              title="Edit user"
              sx={{
                color: "secondary.main",
                "&:hover": { bgcolor: "secondary.main", color: "secondary.contrastText" },
              }}
            >
              <EditIcon fontSize="small" />
            </IconButton>
            <IconButton
              size="small"
              onClick={() => handleDeleteUser(userRecord.userId)}
              title="Delete user"
              sx={{
                color: "error.main",
                "&:hover": { bgcolor: "error.main", color: "error.contrastText" },
              }}
            >
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
    userToDelete,
    isDeleteInProgress,
    confirmDeleteUser,
    cancelDelete,
  };
}
