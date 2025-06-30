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

export default function Users() {
  const { columns, editUserOpen, selectedUser, handleCloseEditUser, userToDelete, isDeleteInProgress, confirmDeleteUser, cancelDelete } = useUserTableHeader();

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
      <PageTable
        columns={columns}
        data={users.docs || []}
        tableName="Users Management"
        subTitle="Assign and manage role for users"
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
    </MainCard>
  );
}
