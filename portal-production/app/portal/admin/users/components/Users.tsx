"use client";

import React, { useEffect, useState } from "react";
import AdminCard from "@/components/AdminCard";
import useUserTableHeader from "../hooks/useUserTableHeader";
import PageTable from "@/components/PageTable";
import AddUser from "./AddUser";
import EditUser from "./EditUser";
import { useGetUsers } from "../hooks/useGetUser";
import useAddUserStates from "../hooks/useAddUser";
import DeleteItemDialogNoConfirm from "@/components/DeleteItemDialogNoConfirm";

export default function Users() {
  const { columns, handleEditUser, editUserOpen, selectedUser, handleCloseEditUser, userToDelete, isDeleteInProgress, confirmDeleteUser, cancelDelete } = useUserTableHeader();

  // Use a custom hook for adminMode to fetch all users.
  // Header sorting is applied to the FULL filtered list inside the hook
  // (before its slice) — the table is in manualSorting mode.
  const [sorting, setSorting] = useState<{ id: string; desc: boolean }[]>([]);
  const { users, loading, page, limit, search, filters, setPage, setLimit, setSearch, setFilters, refreshUsers } = useGetUsers(sorting);

  // Sort changes restart at page 1.
  useEffect(() => {
    setPage(1);
  }, [sorting, setPage]);
  const { openDrawer, onAddClick, onCloseClick } = useAddUserStates();

  const handleUserUpdated = () => {
    refreshUsers();
    handleCloseEditUser();
  };

  const handleDeleteConfirm = async () => {
    try {
      await confirmDeleteUser();
      refreshUsers();
    } catch (error) {
      console.error("Failed to delete user:", error);
    }
  };

  return (
    <AdminCard>
      <PageTable
        onRowClick={(r: any) => handleEditUser(r)}
        columns={columns}
        data={users.docs || []}
        manualSorting
        sorting={sorting}
        onSortingChange={setSorting}
        tableName="All Users (Admin)"
        subTitle="View and manage users across all organizations"
        buttonName="Add User"
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

      <AddUser open={openDrawer} onClose={onCloseClick} onUserCreated={refreshUsers} />

      {selectedUser && <EditUser open={editUserOpen} onClose={handleCloseEditUser} user={selectedUser} onUserUpdated={handleUserUpdated} />}

      <DeleteItemDialogNoConfirm open={!!userToDelete} onCancel={cancelDelete} onConfirm={handleDeleteConfirm} loading={isDeleteInProgress} />
    </AdminCard>
  );
}
