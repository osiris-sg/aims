"use client";

import React from "react";

import MainCard from "@/components/MainCard";
import useInventoryTableHeader from "./hooks/useInventoryTableHeader";
import PageTable from "@/components/PageTable";
import AddInventoryItem from "./components/AddInventoryItem";
import { useGetInventories } from "./hooks/useGetInventories";
import useAddInventoryStates from "./hooks/useAddInventoryStates";
import ViewQRDialog from "./components/ViewQRDialog";
import useViewQRHandler from "./hooks/useViewQRHandler";
import { selectOpenQRDialog } from "./slice/selectors";
import { useSelector } from "react-redux";

export default function Inventory() {
  const { columns, deleteDialog } = useInventoryTableHeader();
  const { inventories, loading, page, limit, search, filters, setPage, setLimit, setSearch, setFilters } = useGetInventories();
  const { openDrawer, onAddClick, onCloseClick } = useAddInventoryStates();
  const { closeQRDialog, isQRLoading, qrCode } = useViewQRHandler();
  const qrDialogOpen = useSelector(selectOpenQRDialog);

  return (
    <MainCard>
      <PageTable
        columns={columns}
        data={inventories.docs}
        tableName="Inventory List"
        subTitle="Items Detail Information"
        buttonName="Add Items"
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
      <ViewQRDialog open={qrDialogOpen} onClose={closeQRDialog} isQRLoading={isQRLoading} qrCode={qrCode} />
      {deleteDialog}
    </MainCard>
  );
}
