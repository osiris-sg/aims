"use client";

import React from "react";
import MainCard from "@/components/MainCard";
import useUserTableHeader from "../hooks/useUserTableHeader";
import PageTable from "@/components/PageTable";
import EditUser from "./EditUser";
import { useGetUsers } from "../hooks/useGetUser";
import DeleteItemDialogNoConfirm from "@/components/DeleteItemDialogNoConfirm";
import TeamsPanel from "./TeamsPanel";
import AddUserDialog from "./AddUserDialog";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import { useTranslations } from "next-intl";

export default function Users() {
  const { isIdQuotationEnabled } = useOrganizationFeatures();
  const t = useTranslations("users.list");
  const { columns, handleEditUser, editUserOpen, selectedUser, handleCloseEditUser, userToDelete, isDeleteInProgress, confirmDeleteUser, cancelDelete } = useUserTableHeader();

  const { users, loading, page, limit, search, filters, setPage, setLimit, setSearch, setFilters, refreshUsers } = useGetUsers();
  // "Add user": email + role (an existing login in any org, or a new one), multi-org users 2026-11-02.
  const [addOpen, setAddOpen] = React.useState(false);

  const handleUserUpdated = () => {
    refreshUsers();
    handleCloseEditUser();
  };

  const handleDeleteConfirm = async () => {
    try {
      await confirmDeleteUser();
      refreshUsers(); // Refresh the users list after successful deletion
    } catch (error) {
      console.error("Failed to delete user:", error);
      // You might want to show a toast/snackbar error message here
    }
  };

  return (
    <MainCard>
      <PageTable
        onRowClick={(r: any) => handleEditUser(r)}
        columns={columns}
        data={users.docs || []}
        tableName={t("tableName")}
        subTitle={t("subTitle")}
        buttonName={t("add")}
        onAddClick={() => setAddOpen(true)}
        loading={loading}
        page={page}
        limit={limit}
        search={search}
        filters={filters}
        setPage={setPage}
        setLimit={setLimit}
        setSearch={setSearch}
        setFilters={setFilters}
        availableFilters={["createdOn"]}
        pageCount={users.totalPagesCount}
        totalDocs={users.totalDocuments}
      />

      {isIdQuotationEnabled && <TeamsPanel />}

      <AddUserDialog open={addOpen} onClose={() => setAddOpen(false)} onDone={refreshUsers} />

      {selectedUser && <EditUser open={editUserOpen} onClose={handleCloseEditUser} user={selectedUser} onUserUpdated={handleUserUpdated} />}

      <DeleteItemDialogNoConfirm open={!!userToDelete} onCancel={cancelDelete} onConfirm={handleDeleteConfirm} loading={isDeleteInProgress} />
    </MainCard>
  );
}
