"use client";

import React, { useEffect, useState } from "react";
import { Tab, Tabs } from "@mui/material";
import { useAuth } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import { request } from "@/helpers/request";
import { replyBody, requestFailed } from "@/helpers/requestOutcome";
import RolesPanel from "@/app/portal/settings/roles/_components/RolesPanel";
import MainCard from "@/components/MainCard";
import useUserTableHeader from "../hooks/useUserTableHeader";
import PageTable from "@/components/PageTable";
import AddUser from "./AddUser";
import EditUser from "./EditUser";
import { useGetUsers } from "../hooks/useGetUser";
import useAddRoleStates from "../hooks/useAddUser";
import DeleteItemDialogNoConfirm from "@/components/DeleteItemDialogNoConfirm";
import TeamsPanel from "./TeamsPanel";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import { useTranslations } from "next-intl";

export default function Users() {
  const { isIdQuotationEnabled, isCustomAccessEnabled } = useOrganizationFeatures();
  // Roles tab (enableCustomAccess, WCT group 2026-11-23): for people with Org Settings edit (GET /access canManage).
  const { getToken } = useAuth();
  const params = useSearchParams();
  const [canManageRoles, setCanManageRoles] = useState(false);
  const [tab, setTab] = useState<"users" | "roles">(params?.get("tab") === "roles" ? "roles" : "users");
  useEffect(() => {
    if (!isCustomAccessEnabled) return setCanManageRoles(false);
    let gone = false;
    (async () => {
      const token = await getToken();
      const res = await request({ path: "/access", method: "GET", ownError: true, quiet: true } as any, {}, token ?? undefined);
      if (!gone) setCanManageRoles(!requestFailed(res) && !!(replyBody(res) as any)?.canManage);
    })();
    return () => {
      gone = true;
    };
  }, [isCustomAccessEnabled, getToken]);
  const showRoles = !!isCustomAccessEnabled && canManageRoles;
  const t = useTranslations("users.list");
  const { columns, handleEditUser, editUserOpen, selectedUser, handleCloseEditUser, userToDelete, isDeleteInProgress, confirmDeleteUser, cancelDelete } = useUserTableHeader();

  const { users, loading, page, limit, search, filters, setPage, setLimit, setSearch, setFilters, refreshUsers } = useGetUsers();
  const { openDrawer, onAddClick, onCloseClick } = useAddRoleStates();

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
      {showRoles && (
        <Tabs value={tab} onChange={(_e, v) => {
            setTab(v);
            if (v === "users") refreshUsers();
          }} sx={{ mb: 2, borderBottom: 1, borderColor: "divider" }}>
          <Tab value="users" label="Users" />
          <Tab value="roles" label="Roles" data-tour="roles-tab" />
        </Tabs>
      )}
      {showRoles && tab === "roles" ? (
        <RolesPanel />
      ) : (
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
      )}

      {isIdQuotationEnabled && <TeamsPanel />}

      <AddUser open={openDrawer} onClose={onCloseClick} onUserCreated={refreshUsers} />

      {selectedUser && <EditUser open={editUserOpen} onClose={handleCloseEditUser} user={selectedUser} onUserUpdated={handleUserUpdated} />}

      <DeleteItemDialogNoConfirm open={!!userToDelete} onCancel={cancelDelete} onConfirm={handleDeleteConfirm} loading={isDeleteInProgress} />
    </MainCard>
  );
}
