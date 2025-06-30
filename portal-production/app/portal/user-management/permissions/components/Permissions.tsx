"use client";

import React from "react";
import MainCard from "@/components/MainCard";
import useRoleTableHeader from "../hooks/useRoleTableHeader";
import PageTable from "@/components/PageTable";
import AddRoleItem from "./AddRoleItem";
import { useGetRoles } from "../hooks/useGetRoles";
import useAddRoleStates from "../hooks/useAddRoleStates";
import EditPermissions from "./EditPermissions";

export default function Permissions() {
  const { columns, editPermissionsOpen, selectedRole, handleCloseEditPermissions } = useRoleTableHeader();
  const { roles, loading, page, limit, search, filters, setPage, setLimit, setSearch, setFilters, refreshRoles } = useGetRoles();
  const { openDrawer, onAddClick, onCloseClick } = useAddRoleStates();

  const handlePermissionsUpdated = () => {
    refreshRoles();
    handleCloseEditPermissions();
  };

  return (
    <MainCard>
      <PageTable
        columns={columns}
        data={roles.docs}
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
      <AddRoleItem open={openDrawer} onClose={onCloseClick} />

      {selectedRole && <EditPermissions open={editPermissionsOpen} onClose={handleCloseEditPermissions} role={selectedRole} onPermissionsUpdated={handlePermissionsUpdated} />}
    </MainCard>
  );
}
