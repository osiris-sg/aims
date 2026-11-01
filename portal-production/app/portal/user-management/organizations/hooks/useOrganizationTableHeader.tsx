import React, { useState } from "react";
import { createColumnHelper } from "@tanstack/react-table";
import { Box, Chip, Typography } from "@mui/material";
import { kebabColumn } from "@/components/RowKebab";
import { useUiLang } from "@/i18n/UiLangProvider";
import { formatDate } from "@/i18n/lang";
import { useAuth } from "@clerk/nextjs";
import { useTranslations } from "next-intl";

const columnHelper = createColumnHelper<any>();

export default function useOrganizationTableHeader() {
  const { getToken } = useAuth();
  const t = useTranslations("users.orgs");
  const { lang } = useUiLang();
  const [editOrganizationOpen, setEditOrganizationOpen] = useState(false);
  const [selectedOrganization, setSelectedOrganization] = useState(null);
  const [organizationToDelete, setOrganizationToDelete] = useState<string | null>(null);
  const [isDeleteInProgress, setIsDeleteInProgress] = useState(false);

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
      header: t("name"),
      cell: (info) => (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Typography variant="body2" sx={{ fontWeight: 500 }}>
            {info.getValue()}
          </Typography>
        </Box>
      ),
    }),
    columnHelper.accessor("id", {
      header: t("id"),
      cell: (info) => (
        <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums", fontSize: "0.8rem" }}>
          {info.getValue()}
        </Typography>
      ),
    }),
    columnHelper.accessor("_count.userOrganizations", {
      header: t("users"),
      cell: (info) => <Chip label={info.getValue() || 0} size="small" variant="outlined" sx={{ fontSize: "0.75rem" }} />,
    }),
    columnHelper.accessor("_count.assets", {
      header: t("assets"),
      cell: (info) => <Chip label={info.getValue() || 0} size="small" variant="outlined" sx={{ fontSize: "0.75rem" }} />,
    }),
    columnHelper.accessor("createdAt", {
      header: t("created"),
      cell: (info) => (
        <Typography variant="body2" sx={{ fontSize: "0.8rem" }}>
          {lang === "ja" ? formatDate(info.getValue(), "ja") : new Date(info.getValue()).toLocaleDateString()}
        </Typography>
      ),
    }),
    kebabColumn((row: any) => [
      { label: t("edit"), onClick: () => handleEditOrganization(row) },
      { label: t("delete"), destructive: true, onClick: () => handleDeleteOrganization(row.id) },
    ]),
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
