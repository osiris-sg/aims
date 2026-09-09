"use client";

import React, { useEffect, useState } from "react";
import AdminCard from "@/components/AdminCard";
import PageTable from "@/components/PageTable";
import AddOrganizationItem from "./AddOrganizationItem";
import { useGetOrganizations } from "../hooks/useGetOrganizations";
import useAddOrganizationStates from "../hooks/useAddOrganizationStates";
import EditOrganization from "./EditOrganization";
import DeleteItemDialogNoConfirm from "@/components/DeleteItemDialogNoConfirm";
import useOrganizationTableHeader from "../hooks/useOrganizationTableHeader";
import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutline";
import { Button } from "@mui/material";

export default function Organizations() {
  const { columns, handleViewOrganization, editOrganizationOpen, selectedOrganization, handleCloseEditOrganization, organizationToDelete, isDeleteInProgress, confirmDeleteOrganization, cancelDelete } = useOrganizationTableHeader();

  // Header sorting is applied to the FULL filtered list inside the hook
  // (before its slice) — the table is in manualSorting mode.
  const [sorting, setSorting] = useState<{ id: string; desc: boolean }[]>([]);
  const { organizations, loading, page, limit, search, filters, setPage, setLimit, setSearch, setFilters, refreshOrganizations } = useGetOrganizations(sorting);

  // Sort changes restart at page 1.
  useEffect(() => {
    setPage(1);
  }, [sorting, setPage]);

  const { openOrganizationDrawer, onAddOrganizationClick, onCloseOrganizationClick } = useAddOrganizationStates();

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
    <AdminCard>
      <PageTable
        onRowClick={(r: any) => handleViewOrganization(r.id)}
        data={organizations.docs}
        columns={columns}
        manualSorting
        sorting={sorting}
        onSortingChange={setSorting}
        tableName="Organizations Management (Admin)"
        subTitle="Manage all organizations across the platform"
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
        actionButtons={[
          <Button variant="contained" color="secondary" startIcon={<AddCircleOutlineIcon />} onClick={onAddOrganizationClick}>
            Add Org
          </Button>,
        ]}
      />

      <AddOrganizationItem open={openOrganizationDrawer} onClose={onCloseOrganizationClick} onOrganizationCreated={refreshOrganizations} />

      <EditOrganization open={editOrganizationOpen} onClose={handleCloseEditOrganization} organization={selectedOrganization} onOrganizationUpdated={handleOrganizationUpdated} />

      <DeleteItemDialogNoConfirm open={!!organizationToDelete} onConfirm={handleDeleteConfirm} onCancel={cancelDelete} loading={isDeleteInProgress} />
    </AdminCard>
  );
}
