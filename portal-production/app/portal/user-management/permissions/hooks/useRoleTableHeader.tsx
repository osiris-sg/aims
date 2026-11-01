import React, { useState } from "react";
import { createColumnHelper } from "@tanstack/react-table";
import { Chip, Typography } from "@mui/material";
import { kebabColumn } from "@/components/RowKebab";
import { useUiLang } from "@/i18n/UiLangProvider";
import { formatDate } from "@/i18n/lang";
import { useAuth } from "@clerk/nextjs";
import { useTranslations } from "next-intl";

const columnHelper = createColumnHelper<any>();

export default function useRoleTableHeader() {
  const { getToken } = useAuth();
  const t = useTranslations("users.roles");
  const { lang } = useUiLang();
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
      header: t("name"),
      cell: (info) => (
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          {info.getValue()}
        </Typography>
      ),
    }),
    columnHelper.accessor("description", {
      header: t("description"),
      cell: (info) => info.getValue(),
    }),
    columnHelper.accessor("permissions", {
      header: t("count"),
      cell: (info) => {
        const permissions = info.getValue();
        const count = Array.isArray(permissions) ? permissions.length : 0;
        return <Chip label={t("permCount", { n: count })} size="small" variant="outlined" sx={{ borderRadius: "4px" }} />;
      },
    }),
    columnHelper.accessor("createdAt", {
      header: t("created"),
      cell: (info) => (lang === "ja" ? formatDate(info.getValue(), "ja") : new Date(info.getValue()).toLocaleDateString()),
    }),
    kebabColumn((row: any) => [
      { label: t("edit"), onClick: () => handleEditRole(row) },
      { label: t("delete"), destructive: true, onClick: () => handleDeleteRole(row.id) },
    ]),
  ];

  return {
    columns,
    handleEditRole,
    editRoleOpen,
    selectedRole,
    handleCloseEditRole,
    roleToDelete,
    isDeleteInProgress,
    confirmDeleteRole,
    cancelDelete,
  };
}
