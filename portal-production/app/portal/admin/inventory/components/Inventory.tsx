"use client";

import React, { useEffect, useState } from "react";
import AdminCard from "@/components/AdminCard";
import PageTable from "@/components/PageTable";
import { useGetInventory } from "../hooks/useGetInventory";
import useInventoryTableHeader from "../hooks/useInventoryTableHeader";

export default function Inventory() {
  const { columns, deleteDialog, handleViewItem } = useInventoryTableHeader();
  // Header sorting is applied to the FULL filtered list inside the hook
  // (before its slice) — the table is in manualSorting mode.
  const [sorting, setSorting] = useState<{ id: string; desc: boolean }[]>([]);
  const { inventory, loading, page, limit, search, filters, setPage, setLimit, setSearch, setFilters } = useGetInventory(sorting);

  // Sort changes restart at page 1.
  useEffect(() => {
    setPage(1);
  }, [sorting, setPage]);

  return (
    <AdminCard>
      <PageTable
        onRowClick={(r: any) => handleViewItem(r)}
        loading={loading}
        columns={columns}
        data={inventory.docs}
        manualSorting
        sorting={sorting}
        onSortingChange={setSorting}
        tableName="All Inventory (Admin)"
        subTitle="View all inventory items across organizations"
        // buttonName="View Details"
        page={page}
        limit={limit}
        search={search}
        filters={filters}
        setPage={setPage}
        setLimit={setLimit}
        setSearch={setSearch}
        setFilters={setFilters}
        availableFilters={["status", "organization"]}
        pageCount={inventory.totalPagesCount}
        totalDocs={inventory.totalDocuments}
      />
      {deleteDialog}
    </AdminCard>
  );
}
