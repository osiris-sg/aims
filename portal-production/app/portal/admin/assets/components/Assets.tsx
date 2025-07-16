"use client";

import React from "react";
import AdminCard from "@/components/AdminCard";
import PageTable from "@/components/PageTable";
import { useGetAssets } from "../hooks/useGetAssets";
import useAssetsTableHeader from "../hooks/useAssetsTableHeader";

export default function Assets() {
  const { columns, deleteDialog } = useAssetsTableHeader();
  const { assets, loading, page, limit, search, filters, setPage, setLimit, setSearch, setFilters } = useGetAssets();

  return (
    <AdminCard>
      <PageTable
        loading={loading}
        columns={columns}
        data={assets.docs}
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
