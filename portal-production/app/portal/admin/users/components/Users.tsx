"use client";

import React from "react";
import AdminCard from "@/components/AdminCard";
import useUserTableHeader from "../hooks/useUserTableHeader";
import PageTable from "@/components/PageTable";
import AddUser from "./AddUser";
import EditUser from "./EditUser";
import { useGetUsers } from "../hooks/useGetUser";
import useAddUserStates from "../hooks/useAddUser";
import DeleteItemDialogNoConfirm from "@/components/DeleteItemDialogNoConfirm";

export default function Users() {
  const { columns, editUserOpen, selectedUser, handleCloseEditUser, userToDelete, isDeleteInProgress, confirmDeleteUser, cancelDelete } = useUserTableHeader();

  // Use a custom hook for adminMode to fetch all users
  const { users, loading, page, limit, search, filters, setPage, setLimit, setSearch, setFilters, refreshUsers } = useGetUsers();
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
        columns={columns}
        data={users.docs || []}
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
