"use client";

import React from "react";
import MainCard from "@/components/MainCard";
import useUserTableHeader from "../hooks/useUserTableHeader";
import PageTable from "@/components/PageTable";
import AddUser from "./AddUser";
import EditUser from "./EditUser";
import { useGetUsers } from "../hooks/useGetUser";
import useAddRoleStates from "../hooks/useAddUser";
import DeleteItemDialogNoConfirm from "@/components/DeleteItemDialogNoConfirm";
import TeamsPanel from "./TeamsPanel";
import AddByEmail from "./AddByEmail";
import InvitesPanel from "./InvitesPanel";
import { Button, Stack } from "@mui/material";
import { useUserPermissions } from "@/app/portal/hooks/useUserPermissions";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import { useTranslations } from "next-intl";

export default function Users() {
  const { isIdQuotationEnabled } = useOrganizationFeatures();
  const t = useTranslations("users.list");
  const { columns, handleEditUser, editUserOpen, selectedUser, handleCloseEditUser, userToDelete, isDeleteInProgress, confirmDeleteUser, cancelDelete } = useUserTableHeader();

  const { users, loading, page, limit, search, filters, setPage, setLimit, setSearch, setFilters, refreshUsers } = useGetUsers();
  const { openDrawer, onAddClick, onCloseClick } = useAddRoleStates();
  // Multi-org users (2026-11-02): give a person (an existing login or a new invite) access to this org by email.
  const ti = useTranslations("users.invite");
  const { hasPermission, userRoles } = useUserPermissions();
  const canAdd = hasPermission("users", "create") || userRoles.length === 0;
  const [byEmailOpen, setByEmailOpen] = React.useState(false);
  const [invitesKey, setInvitesKey] = React.useState(0);

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
      {canAdd && (
        <Stack direction="row" justifyContent="flex-end" sx={{ mb: 1 }}>
          <Button size="small" variant="outlined" onClick={() => setByEmailOpen(true)} data-tour="users-add-by-email">
            {ti("open")}
          </Button>
        </Stack>
      )}
      <PageTable
        onRowClick={(r: any) => handleEditUser(r)}
        columns={columns}
        data={users.docs || []}
        tableName={t("tableName")}
        subTitle={t("subTitle")}
        buttonName={t("add")}
        onAddClick={onAddClick}
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

      <InvitesPanel refreshKey={invitesKey} />

      {isIdQuotationEnabled && <TeamsPanel />}

      <AddByEmail
        open={byEmailOpen}
        onClose={() => setByEmailOpen(false)}
        onDone={() => {
          refreshUsers();
          setInvitesKey((k) => k + 1);
        }}
      />

      <AddUser open={openDrawer} onClose={onCloseClick} onUserCreated={refreshUsers} />

      {selectedUser && <EditUser open={editUserOpen} onClose={handleCloseEditUser} user={selectedUser} onUserUpdated={handleUserUpdated} />}

      <DeleteItemDialogNoConfirm open={!!userToDelete} onCancel={cancelDelete} onConfirm={handleDeleteConfirm} loading={isDeleteInProgress} />
    </MainCard>
  );
}
