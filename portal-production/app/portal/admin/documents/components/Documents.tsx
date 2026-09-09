"use client";

import React, { useEffect, useState } from "react";
import AdminCard from "@/components/AdminCard";
import PageTable from "@/components/PageTable";
import { useGetDocuments } from "../hooks/useGetDocuments";
import useDocumentsTableHeader from "../hooks/useDocumentsTableHeader";

export default function Documents() {
  const { columns, deleteDialog } = useDocumentsTableHeader();
  // Header sorting is applied to the FULL filtered list inside the hook
  // (before its slice) — the table is in manualSorting mode.
  const [sorting, setSorting] = useState<{ id: string; desc: boolean }[]>([]);
  const { documents, loading, page, limit, search, filters, setPage, setLimit, setSearch, setFilters } = useGetDocuments(sorting);

  // Sort changes restart at page 1.
  useEffect(() => {
    setPage(1);
  }, [sorting, setPage]);

  return (
    <AdminCard>
      <PageTable
        onRowClick={(r: any) => window.open(`/portal/documents/view/${r.type}/${r.documentTemplateId}/${r.id}`, "_blank")}
        loading={loading}
        columns={columns}
        data={documents.docs}
        manualSorting
        sorting={sorting}
        onSortingChange={setSorting}
        tableName="All Documents (Admin)"
        subTitle="View all documents across organizations"
        // buttonName="View Details"
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
    </AdminCard>
  );
}
