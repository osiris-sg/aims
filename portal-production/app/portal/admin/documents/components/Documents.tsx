"use client";

import React from "react";
import MainCard from "@/components/MainCard";
import PageTable from "@/components/PageTable";
import { useGetDocuments } from "../hooks/useGetDocuments";
import useDocumentsTableHeader from "../hooks/useDocumentsTableHeader";

export default function Documents() {
  const { columns, deleteDialog } = useDocumentsTableHeader();
  const { documents, loading, page, limit, search, filters, setPage, setLimit, setSearch, setFilters } = useGetDocuments();

  return (
    <MainCard>
      <PageTable
        loading={loading}
        columns={columns}
        data={documents.docs}
        tableName="All Documents (Admin)"
        subTitle="View all documents across organizations"
        buttonName="View Details"
        page={page}
        limit={limit}
        search={search}
        filters={filters}
        setPage={setPage}
        setLimit={setLimit}
        setSearch={setSearch}
        setFilters={setFilters}
        availableFilters={["type", "organization"]}
        pageCount={documents.totalPagesCount}
        totalDocs={documents.totalDocuments}
      />
      {deleteDialog}
    </MainCard>
  );
}
