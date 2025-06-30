"use client";

import React from "react";
import MainCard from "@/components/MainCard";
import useUserTableHeader from "../hooks/useUserTableHeader";
import PageTable from "@/components/PageTable";
import AddUser from "./AddUser";
import { useGetUsers } from "../hooks/useGetUser";
import useAddRoleStates from "../hooks/useAddUser";
import EditPermissions from "./EditPermissions";

export default function Users() {
  const { columns, editUserOpen, selectedUser, handleCloseEditUser } = useUserTableHeader();
  const { users, loading, page, limit, search, filters, setPage, setLimit, setSearch, setFilters, refreshUsers } = useGetUsers();
  const { openDrawer, onAddClick, onCloseClick } = useAddRoleStates();

  const handlePermissionsUpdated = () => {
    refreshUsers();
    handleCloseEditUser();
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
      <AddUser open={openDrawer} onClose={onCloseClick} />

      {selectedUser && <EditPermissions open={editUserOpen} onClose={handleCloseEditUser} role={selectedUser} onPermissionsUpdated={handlePermissionsUpdated} />}
    </MainCard>
  );
}
