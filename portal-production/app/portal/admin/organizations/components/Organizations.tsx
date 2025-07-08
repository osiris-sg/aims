"use client";

import React from "react";
import MainCard from "@/components/MainCard";
import PageTable from "@/components/PageTable";
import AddOrganizationItem from "./AddOrganizationItem";
import { useGetOrganizations } from "../hooks/useGetOrganizations";
import useAddOrganizationStates from "../hooks/useAddOrganizationStates";
import EditOrganization from "./EditOrganization";
import DeleteItemDialogNoConfirm from "@/components/DeleteItemDialogNoConfirm";
import useOrganizationTableHeader from "../hooks/useOrganizationTableHeader";

export default function Organizations() {
  const { columns, editOrganizationOpen, selectedOrganization, handleCloseEditOrganization, organizationToDelete, isDeleteInProgress, confirmDeleteOrganization, cancelDelete } = useOrganizationTableHeader();

  const { organizations, loading, page, limit, search, filters, setPage, setLimit, setSearch, setFilters, refreshOrganizations } = useGetOrganizations();

  const { openDrawer, onAddClick, onCloseClick } = useAddOrganizationStates();

  const handleOrganizationUpdated = () => {
    refreshOrganizations();
    handleCloseEditOrganization();
  };

  const handleDeleteConfirm = async () => {
    try {
      await confirmDeleteOrganization();
      refreshOrganizations();
    } catch (error) {
      console.error("Error deleting organization:", error);
    }
  };

  return (
    <MainCard>
      <PageTable
        data={organizations.docs}
        columns={columns}
        tableName="Organizations Management (Admin)"
        subTitle="Manage all organizations across the platform"
        buttonName="Add Organization"
        onAddClick={onAddClick}
        loading={loading}
        page={page}
        setPage={setPage}
        limit={limit}
        setLimit={setLimit}
        search={search}
        setSearch={setSearch}
        filters={filters}
        setFilters={setFilters}
        availableFilters={["createdOn"]}
        pageCount={organizations.totalPagesCount}
        totalDocs={organizations.totalDocuments}
      />

      <AddOrganizationItem open={openDrawer} onClose={onCloseClick} onOrganizationCreated={refreshOrganizations} />

      <EditOrganization open={editOrganizationOpen} onClose={handleCloseEditOrganization} organization={selectedOrganization} onOrganizationUpdated={handleOrganizationUpdated} />

      <DeleteItemDialogNoConfirm open={!!organizationToDelete} onConfirm={handleDeleteConfirm} onCancel={cancelDelete} loading={isDeleteInProgress} />
    </MainCard>
  );
}
