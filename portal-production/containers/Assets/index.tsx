"use client";
import React from "react";
import MainCard from "@/components/MainCard";
import useAssetsTableHeader from "./hooks/useAssetsTableHeader";
import PageTable from "@/components/PageTable";
import { useGetAssets } from "./hooks/useGetAssets";
import useAddAssetClickHandler from "./hooks/useAddAssetClickHandler";
import DeleteItemDialog from "@/components/DeleteItemDialog";
import useDeleteAssetHandler from "./hooks/useDeleteAssetHandler";
import useGetCategories from "../AddAsset/hooks/useGetCategories";

export default function Assets() {
  const { columns, deleteDialog } = useAssetsTableHeader();
  const { assets, loading, page, limit, search, filters, setPage, setLimit, setSearch, setFilters } = useGetAssets();
  const { onAddClick } = useAddAssetClickHandler();
  const { assetToDelete, isDeleteInProgress, onDeleteConfirm, setAssetToDelete } = useDeleteAssetHandler();
  useGetCategories();

  return (
    <MainCard>
      <PageTable
        loading={loading}
        columns={columns}
        data={assets.docs}
        tableName="All Assets"
        subTitle="Items Detail Information"
        buttonName="Add Asset"
        page={page}
        limit={limit}
        search={search}
        filters={filters}
        setPage={setPage}
        setLimit={setLimit}
        setSearch={setSearch}
        setFilters={setFilters}
        onAddClick={onAddClick}
        availableFilters={["status", "category"]}
        pageCount={assets.totalPagesCount}
        totalDocs={assets.totalDocuments}
      />
      {deleteDialog}
    </MainCard>
  );
}
