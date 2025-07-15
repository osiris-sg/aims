"use client";

import React from "react";
import MainCard from "@/components/MainCard";
import PageTable from "@/components/PageTable";
import { useGetInventory } from "../hooks/useGetInventory";
import useInventoryTableHeader from "../hooks/useInventoryTableHeader";

export default function Inventory() {
  const { columns, deleteDialog } = useInventoryTableHeader();
  const { inventory, loading, page, limit, search, filters, setPage, setLimit, setSearch, setFilters } = useGetInventory();

  return (
    <MainCard>
      <PageTable
        loading={loading}
        columns={columns}
        data={inventory.docs}
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
    </MainCard>
  );
}
