import React, { useState } from "react";
import { createColumnHelper } from "@tanstack/react-table";
import { Box, Chip, Typography, Avatar } from "@mui/material";
import PersonIcon from "@mui/icons-material/Person";
import { kebabColumn } from "@/components/RowKebab";
import { request } from "@/helpers/request";
import { useAuth } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import { useUiLang } from "@/i18n/UiLangProvider";
import { formatDate } from "@/i18n/lang";

const columnHelper = createColumnHelper<any>();

export default function useUserTableHeader() {
  const [editUserOpen, setEditUserOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [userToDelete, setUserToDelete] = useState<string | null>(null);
  const [isDeleteInProgress, setIsDeleteInProgress] = useState(false);
  const { getToken } = useAuth();
  const t = useTranslations("users.list");
  const { lang } = useUiLang();

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
      header: t("user"),
      cell: (info) => {
        const user = info.row.original;
        return (
          <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
            <Avatar sx={{ width: 32, height: 32 }}>
              <PersonIcon fontSize="small" />
            </Avatar>
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                {user.email || user.name}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {/* No email (a phone-only login): its name, then its phone; never its id. */}
                {user.email ? user.name : [user.phone, t("noEmail")].filter(Boolean).join(" · ")}
              </Typography>
            </Box>
          </Box>
        );
      },
    }),
    columnHelper.accessor("roles", {
      header: t("roles"),
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
                {t("noRoles")}
              </Typography>
            )}
          </Box>
        );
      },
    }),
    columnHelper.accessor("whatsappNumber", {
      header: t("whatsapp"),
      cell: (info: any) => {
        const n = info.getValue() as string | null;
        return n ? <Chip label={t("linked", { last4: String(n).slice(-4) })} size="small" color="success" variant="outlined" sx={{ borderRadius: "4px" }} title={t("linkedTip")} /> : <Typography variant="caption" color="text.secondary">—</Typography>;
      },
    }),
    columnHelper.accessor(
      (row) => {
        // UNIQUE permissions across roles — roles overlap heavily (Designer ⊂
        // Management), so a plain sum inflated the count (guru 2026-09-24).
        const ids = new Set<string>();
        row.roles?.forEach((role: any) => role.permissions?.forEach((p: any) => ids.add(p.id)));
        return ids.size as unknown;
      },
      {
        id: "permissions",
        header: t("permissions"),
        cell: (info: any) => {
          const totalPermissions = info.getValue() as number;
          return <Chip label={t("permCount", { n: totalPermissions })} size="small" variant="outlined" sx={{ borderRadius: "4px" }} />;
        },
      }
    ),
    columnHelper.accessor("createdAt", {
      header: t("created"),
      cell: (info) => {
        return <Typography variant="body2">{lang === "ja" ? formatDate(info.getValue(), "ja") : new Date(info.getValue()).toLocaleDateString()}</Typography>;
      },
    }),
    kebabColumn((row: any) => [
      { label: t("edit"), onClick: () => handleEditUser(row) },
      { label: t("remove"), destructive: true, onClick: () => handleDeleteUser(row.id) },
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
