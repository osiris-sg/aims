"use client";

import React, { useEffect, useState } from "react";
import MainCard from "@/components/MainCard";
import useRoleTableHeader from "../hooks/useRoleTableHeader";
import PageTable from "@/components/PageTable";
import AddRoleItem from "./AddRoleItem";
import { useGetRoles } from "../hooks/useGetRoles";
import useAddRoleStates from "../hooks/useAddRoleStates";
import EditRole from "./EditRole";
import DeleteItemDialogNoConfirm from "@/components/DeleteItemDialogNoConfirm";

export default function Permissions() {
  const { columns, handleEditRole, editRoleOpen, selectedRole, handleCloseEditRole, roleToDelete, isDeleteInProgress, confirmDeleteRole, cancelDelete } = useRoleTableHeader();
  // Header sorting is applied to the FULL list inside the hook (before its
  // slice) — the table is in manualSorting mode.
  const [sorting, setSorting] = useState<{ id: string; desc: boolean }[]>([]);
  const { roles, loading, page, limit, search, filters, setPage, setLimit, setSearch, setFilters, refreshRoles } = useGetRoles(sorting);

  // Sort changes restart at page 1.
  useEffect(() => {
    setPage(1);
  }, [sorting, setPage]);
  const { openDrawer, onAddClick, onCloseClick } = useAddRoleStates();

  const handleRoleUpdated = () => {
    refreshRoles();
    handleCloseEditRole();
  };

  const handleDeleteConfirm = async () => {
    try {
      await confirmDeleteRole();
      refreshRoles();
    } catch (error) {
      console.error("Error deleting role:", error);
    }
  };

  return (
    <MainCard>
      <PageTable
        onRowClick={(r: any) => handleEditRole(r)}
        columns={columns}
        data={roles.docs}
        manualSorting
        sorting={sorting}
        onSortingChange={setSorting}
        tableName="Role Management"
        subTitle="Assign and manage roles and permissions"
        buttonName="Create Role"
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
        pageCount={roles.totalPagesCount}
        totalDocs={roles.totalDocuments}
      />
      <AddRoleItem open={openDrawer} onClose={onCloseClick} onRoleCreated={refreshRoles} />

      {selectedRole && <EditRole open={editRoleOpen} onClose={handleCloseEditRole} role={selectedRole} onRoleUpdated={handleRoleUpdated} />}

      <DeleteItemDialogNoConfirm open={!!roleToDelete} onCancel={cancelDelete} onConfirm={handleDeleteConfirm} loading={isDeleteInProgress} />
    </MainCard>
  );
}
