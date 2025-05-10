"use client";

import React from "react";

import MainCard from "@/components/MainCard";
import useDocumentTableHeader from "./hooks/useDocumentTableHeader";
import PageTable from "@/components/PageTable";
import AddInventoryItem from "./components/AddInventoryItem";
import { useGetInventories } from "./hooks/useGetInventories";
import useAddInventoryStates from "./hooks/useAddInventoryStates";

export default function Documents() {
  const { columns } = useDocumentTableHeader();
  const { inventories, loading, page, limit, search, filters, setPage, setLimit, setSearch, setFilters } = useGetInventories();
  const { openDrawer, onAddClick, onCloseClick } = useAddInventoryStates();

  return (
    <MainCard>
      <PageTable
        columns={columns}
        data={inventories.docs}
        tableName="Document List"
        subTitle="Document Detail Information"
        buttonName="Create Document"
        onAddClick={onAddClick}
        loading={loading}
        page={page}
        limit={limit}
        search={search}
        filters={filters}
        setPage={setPage}
        setLimit={setLimit}
        setSearch={setSearch}
        setFilters={setFilters}
        availableFilters={["status", "category", "createdOn"]}
        pageCount={inventories.totalPagesCount}
        totalDocs={inventories.totalDocuments}
      />
      <AddInventoryItem open={openDrawer} onClose={onCloseClick} />
    </MainCard>
  );
}
