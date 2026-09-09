"use client";

import React, { useEffect, useState } from "react";
import MainCard from "@/components/MainCard";
import PageTable from "@/components/PageTable";
import AddOrganizationItem from "./AddOrganizationItem";
import { useGetOrganizations } from "../hooks/useGetOrganizations";
import useAddOrganizationStates from "../hooks/useAddOrganizationStates";
import EditOrganization from "./EditOrganization";
import DeleteItemDialogNoConfirm from "@/components/DeleteItemDialogNoConfirm";
import useOrganizationTableHeader from "../hooks/useOrganizationTableHeader";

export default function Organizations() {
  const { columns, editOrganizationOpen, selectedOrganization, handleEditOrganization, handleCloseEditOrganization, organizationToDelete, isDeleteInProgress, confirmDeleteOrganization, cancelDelete } = useOrganizationTableHeader();

  // Header sorting is applied to the FULL list inside the hook (before its
  // slice) — the table is in manualSorting mode.
  const [sorting, setSorting] = useState<{ id: string; desc: boolean }[]>([]);
  const { organizations, loading, page, limit, search, filters, setPage, setLimit, setSearch, setFilters, refreshOrganizations } = useGetOrganizations(sorting);

  // Sort changes restart at page 1.
  useEffect(() => {
    setPage(1);
  }, [sorting, setPage]);

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
        onRowClick={(r: any) => handleEditOrganization(r)}
        data={organizations.docs}
        columns={columns}
        manualSorting
        sorting={sorting}
        onSortingChange={setSorting}
        tableName="Organizations Management"
        subTitle="Manage all organizations in the platform"
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
