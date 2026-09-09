"use client";

import React, { useEffect, useState } from "react";
import AdminCard from "@/components/AdminCard";
import PageTable from "@/components/PageTable";
import { useGetAssets } from "../hooks/useGetAssets";
import useAssetsTableHeader from "../hooks/useAssetsTableHeader";

export default function Assets() {
  const { columns, deleteDialog, handleViewAsset } = useAssetsTableHeader();
  // Header sorting is applied to the FULL filtered list inside the hook
  // (before its slice) — the table is in manualSorting mode.
  const [sorting, setSorting] = useState<{ id: string; desc: boolean }[]>([]);
  const { assets, loading, page, limit, search, filters, setPage, setLimit, setSearch, setFilters } = useGetAssets(sorting);

  // Sort changes restart at page 1.
  useEffect(() => {
    setPage(1);
  }, [sorting, setPage]);

  return (
    <AdminCard>
      <PageTable
        onRowClick={(r: any) => handleViewAsset(r)}
        loading={loading}
        columns={columns}
        data={assets.docs}
        manualSorting
        sorting={sorting}
        onSortingChange={setSorting}
        tableName="All Assets (Admin)"
        subTitle="View all assets across organizations"
        // buttonName="View Asset Details"
        page={page}
        limit={limit}
        search={search}
        filters={filters}
        setPage={setPage}
        setLimit={setLimit}
        setSearch={setSearch}
        setFilters={setFilters}
        availableFilters={["status", "organization"]}
        pageCount={assets.totalPagesCount}
        totalDocs={assets.totalDocuments}
      />
      {deleteDialog}
    </AdminCard>
  );
}
