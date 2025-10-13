"use client";

import MainCard from "@/components/MainCard";
import PageTable from "@/components/PageTable";
import React from "react";
import { useGetDocuments } from "./hooks/useGetDocuments";
import DeleteItemDialogNoConfirm from "@/components/DeleteItemDialogNoConfirm";
import useDeleteDocumentHandler from "./hooks/useDeleteDocumentHandler";
import useDocumentsTableHeader from "./hooks/useDocumentsTableHeader";

export default function DocumentsTemplateView() {
  const { columns } = useDocumentsTableHeader();
  const { documentTemplates, loading, page, limit, search, setPage, setLimit, setSearch } = useGetDocuments();
  const { documentToDelete, isDeleteInProgress, onDeleteConfirm, setDocumentToDelete } = useDeleteDocumentHandler();

  return (
    <MainCard>
      <PageTable
        loading={loading}
        columns={columns}
        data={documentTemplates.docs}
        tableName="Documents"
        subTitle="Document Templates"
        subRowAccessor="subRows"
        page={page}
        limit={limit}
        search={search}
        setPage={setPage}
        setLimit={setLimit}
        setSearch={setSearch}
        pageCount={documentTemplates.totalPagesCount}
        totalDocs={documentTemplates.totalDocuments}
      />
      <DeleteItemDialogNoConfirm open={!!documentToDelete} onCancel={() => setDocumentToDelete(null)} onConfirm={onDeleteConfirm} loading={isDeleteInProgress} />
    </MainCard>
  );
}
