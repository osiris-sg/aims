"use client";

import React, { useState } from "react";
import MainCard from "@/components/MainCard";
import PageTable from "@/components/PageTable";
import { BulkDeleteBar, useBulkSelection } from "@/components/useBulkSelection";
import { kebabColumn } from "@/components/RowKebab";
import { useRouter, usePathname } from "next/navigation";
import { Avatar, IconButton, Typography, Box, TextField, ToggleButton, ToggleButtonGroup } from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import DeleteItemDialog from "@/components/DeleteItemDialog";
import { useGetAssets, useDeleteAsset, useUpdateAsset, useGetCategories } from "@/app/portal/hooks/api";
import { ROUTES } from "@/routes";
import AssetHierarchyTable from "@/app/portal/assets/components/AssetHierarchyTable";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import ViewListIcon from "@mui/icons-material/ViewList";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import { DEFAULT_PAGE_SIZE } from "@/components/PageTable";

function EditableSkuKeyCell({ row, onSave, onCancel }: { row: any; onSave: (id: string, skuKey: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(row.skuKey);
  return (
    <Box onClick={(e) => e.stopPropagation()} sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
      <TextField
        size="small"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSave(row.id, value);
          if (e.key === "Escape") onCancel();
        }}
        autoFocus
        sx={{ "& .MuiInputBase-input": { py: 0.5, px: 1, fontSize: "0.875rem" } }}
      />
      <IconButton size="small" onClick={() => onSave(row.id, value)} color="success"><CheckIcon fontSize="small" /></IconButton>
      <IconButton size="small" onClick={onCancel} color="error"><CloseIcon fontSize="small" /></IconButton>
    </Box>
  );
}

export default function ProductsPage() {
  const router = useRouter();
  // Carry the current list path (this page is reused at /portal/masterfiles/products)
  // so the add/edit asset editor returns here instead of the standalone assets
  // list (guru 2026-11-16: products live in Master Files now).
  const pathname = usePathname();
  const fromQ = `from=${encodeURIComponent(pathname)}`;
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(DEFAULT_PAGE_SIZE);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({ category: [] as string[] });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteName, setDeleteName] = useState<string | null>(null);
  const [assetToDelete, setAssetToDelete] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"table" | "hierarchy">("table");

  const { isAssetTrackingModeEnabled, isEditInventorySkuEnabled, isTrackedInventoryOnlyEnabled } = useOrganizationFeatures();
  const [editingSkuId, setEditingSkuId] = useState<string | null>(null);
  const updateAssetMutation = useUpdateAsset();

  const handleSaveSkuKey = async (id: string, skuKey: string) => {
    try {
      await updateAssetMutation.mutateAsync({ id, skuKey });
      setEditingSkuId(null);
      refetchAssets();
    } catch (error) {
      console.error("Error updating SKU key:", error);
    }
  };

  const apiFilters = {
    ...filters,
  };

  const { assets = [], total = 0, isLoading: loadingAssets, refetch: refetchAssets } = useGetAssets({
    page,
    limit,
    search,
    filters: apiFilters,
  });

  const hierarchyAssets = assets;

  const { categories = [], isLoading: loadingCategories } = useGetCategories();

  const deleteAssetMutation = useDeleteAsset();
  const bulk = useBulkSelection<any>(assets, { resetKey: `${search}|${JSON.stringify(filters)}` });

  const isLoading = loadingAssets || loadingCategories;

  const deleteAsset = async () => {
    if (!assetToDelete) return;

    try {
      await deleteAssetMutation.mutateAsync(assetToDelete);
      setConfirmOpen(false);
      setAssetToDelete(null);
      refetchAssets();
    } catch (error) {
      console.error("Error deleting asset:", error);
    }
  };

  const baseColumns = [
    {
      accessorKey: "skuKey",
      header: "SKU-Key",
      enableSorting: true,
      cell: ({ row }: any) => {
        const asset = row.original;
        if (isEditInventorySkuEnabled && editingSkuId === asset.id) {
          return <EditableSkuKeyCell row={asset} onSave={handleSaveSkuKey} onCancel={() => setEditingSkuId(null)} />;
        }
        return (
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <Typography variant="body2">{asset.skuKey}</Typography>
            {isEditInventorySkuEnabled && (
              <IconButton
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingSkuId(asset.id);
                }}
                sx={{ opacity: 0.5, "&:hover": { opacity: 1 } }}
              >
                <EditIcon sx={{ fontSize: 14 }} />
              </IconButton>
            )}
          </Box>
        );
      },
    },
    {
      accessorKey: "name",
      header: "Name",
      enableSorting: true,
    },
  ];

  const remainingColumns = [
    {
      accessorKey: "image",
      header: "Image",
      enableSorting: false,
      cell: ({ row }: any) => {
        const imageUrl = row.original.image;
        return <Avatar src={`${process.env.NEXT_PUBLIC_RESOURCE_URL}${imageUrl}`} alt="Image" sx={{ borderRadius: "0.4rem", width: 50, height: 50 }} />;
      },
    },
    {
      id: "category",
      accessorFn: (row: any) => categories?.find((item: any) => item.id === row.categoryId)?.name || "",
      header: "Category",
      enableSorting: true,
      cell: ({ row }: any) => <Typography variant="body2">{categories?.find((item: any) => item.id === row.original.categoryId)?.name}</Typography>,
    },
    {
      accessorKey: "uom",
      header: "UOM",
      enableSorting: true,
      cell: ({ row }: any) => <Typography variant="body2">{row.original.uom || "PCS"}</Typography>,
    },
    {
      id: "stockCount",
      accessorFn: (row: any) => {
        // If asset has inventory items, show instock count; otherwise show quantity
        const hasInventory = (row.instockInventoryCount ?? 0) > 0 || row.isTracked === true;
        return hasInventory ? (row.instockInventoryCount ?? 0) : (row.quantity ?? 0);
      },
      header: "Stock",
      enableSorting: true,
      cell: ({ row }: any) => {
        const hasInventory = (row.original.instockInventoryCount ?? 0) > 0 || row.original.isTracked === true;
        const count = hasInventory ? (row.original.instockInventoryCount ?? 0) : (row.original.quantity ?? 0);
        return (
          <Typography variant="body2">
            {count ?? 0} {hasInventory ? "in stock" : "units"}
          </Typography>
        );
      },
    },
    kebabColumn((row: any) => [
      { label: "Open", onClick: () => router.push(`${ROUTES.ASSETS}/${row.skuKey}`) },
      { label: "Edit", onClick: () => router.push(`${ROUTES.ADD_ASSET}?id=${row.id}&${fromQ}`) },
      {
        label: "Delete",
        destructive: true,
        onClick: () => {
          setDeleteName(row.name);
          setAssetToDelete(row.id);
          setConfirmOpen(true);
        },
      },
    ]),
  ];

  const columns = [...baseColumns, ...remainingColumns];

  return (
    <MainCard>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2, flexWrap: { xs: "wrap", md: "nowrap" }, gap: 1 }}>
        <Typography variant="h6">{isTrackedInventoryOnlyEnabled ? "Inventory" : "Products"}</Typography>
        {/* Tracked-inventory-only orgs (Chong Aik) have no product hierarchy —
            every item is a flat tracked unit, so the Table / Hierarchy toggle is
            dropped and the list stays in table view (guru 2026-11-16). */}
        {!isTrackedInventoryOnlyEnabled && (
          <ToggleButtonGroup value={viewMode} exclusive onChange={(_, newView) => newView && setViewMode(newView)} aria-label="view mode">
            <ToggleButton value="table" aria-label="table view">
              <ViewListIcon sx={{ mr: 1 }} />
              Table
            </ToggleButton>
            <ToggleButton value="hierarchy" aria-label="hierarchy view">
              <AccountTreeIcon sx={{ mr: 1 }} />
              Hierarchy
            </ToggleButton>
          </ToggleButtonGroup>
        )}
      </Box>

      {viewMode === "table" ? (
        <>
  <PageTable
            noSelectionColumn
            onRowClick={(r: any) => router.push(`${ROUTES.ASSETS}/${r.skuKey}`)}
            loading={isLoading}
            columns={[bulk.column, ...(columns)]}
            data={assets}
            tableName={isTrackedInventoryOnlyEnabled ? "All Inventory" : "All Products"}
            subTitle={isTrackedInventoryOnlyEnabled ? "Inventory Detail Information" : "Products Detail Information"}
            buttonName={isTrackedInventoryOnlyEnabled ? "Add Inventory" : "Add Product"}
            page={page}
            limit={limit}
            search={search}
            filters={filters}
            setPage={setPage}
            setLimit={setLimit}
            setSearch={setSearch}
            setFilters={setFilters}
            onAddClick={() => router.push(`${ROUTES.ADD_ASSET}?${fromQ}`)}
            availableFilters={["category"]}
            pageCount={Math.ceil(total / limit)}
            totalDocs={total}
          />
          <BulkDeleteBar bulk={bulk} noun="product" run={(r) => deleteAssetMutation.mutateAsync(r.id)} onDone={() => refetchAssets()} />
        </>
      ) : (
        <AssetHierarchyTable
          assets={hierarchyAssets}
          categories={categories}
          loading={isLoading}
          onView={(skuKey) => router.push(`${ROUTES.ASSETS}/${skuKey}`)}
          onEdit={(id) => router.push(`${ROUTES.ADD_ASSET}?id=${id}&${fromQ}`)}
          onDelete={(id, name) => {
            setDeleteName(name);
            setAssetToDelete(id);
            setConfirmOpen(true);
          }}
          onAddPart={(parentId) => router.push(`${ROUTES.ADD_ASSET}?parentId=${parentId}&${fromQ}`)}
          onAddRootAsset={() => router.push(`${ROUTES.ADD_ASSET}?${fromQ}`)}
          onRefresh={refetchAssets}
        />
      )}

      {deleteName && (
        <DeleteItemDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          dialogTitle="Confirm Delete"
          dialogDescription="Are you sure you want to delete this product?"
          confirmButton={{
            action: deleteAsset,
            children: "Delete",
            buttonProps: {
              variant: "contained",
              color: "error",
            },
          }}
          cancelButton={{
            action: async () => {
              setAssetToDelete(null);
            },
            children: "Cancel",
            buttonProps: {
              variant: "outlined",
            },
          }}
          challengeText={deleteName}
        />
      )}
    </MainCard>
  );
}
