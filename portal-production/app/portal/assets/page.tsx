"use client";
import React, { useMemo, useState } from "react";
import MainCard from "@/components/MainCard";
import PageTable from "@/components/PageTable";
import type { FilterField } from "@/components/FilterDrawer";
import { useRouter } from "next/navigation";
import { Avatar, IconButton, Typography, Box, ToggleButton, ToggleButtonGroup } from "@mui/material";
import VisibilityIcon from "@mui/icons-material/Visibility";
import ModeEditIcon from "@mui/icons-material/ModeEdit";
import DeleteIcon from "@mui/icons-material/Delete";
import DeleteItemDialog from "@/components/DeleteItemDialog";
import { useGetAssets, useDeleteAsset, useGetCategories } from "@/app/portal/hooks/api";
import { ROUTES } from "@/routes";
import AssetHierarchyTable from "./components/AssetHierarchyTable";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import ViewListIcon from "@mui/icons-material/ViewList";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";

export default function AssetsPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<{
    category: string;
    createdOn: { startDate: Date | string | null; endDate: Date | string | null };
  }>({
    category: "",
    createdOn: { startDate: null, endDate: null },
  });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteName, setDeleteName] = useState<string | null>(null);
  const [assetToDelete, setAssetToDelete] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"table" | "hierarchy">("table");

  // Check if tracking mode feature is enabled for this organization
  // ON = tracked assets, OFF = untracked products (organization-wide setting)
  const { isAssetTrackingModeEnabled } = useOrganizationFeatures();

  // Both category and createdOn are applied server-side so filters span all
  // pages (not just the current page) and counts stay consistent.
  const apiFilters = {
    category: filters.category ? [filters.category] : [],
    createdOn: filters.createdOn,
  };

  // Fetch assets with new hook (for table view)
  const { assets = [], total = 0, isLoading: loadingAssets, refetch: refetchAssets } = useGetAssets({
    page,
    limit,
    search,
    filters: apiFilters,
  });

  // Server already applied the filters; render the fetched rows as-is.
  const filteredAssets = assets;

  // Fetch hierarchy assets (for hierarchy view) - we'll need to add this to the hook if not present
  // For now, using the table data
  const hierarchyAssets = assets;

  // Fetch categories
  const { categories = [], isLoading: loadingCategories } = useGetCategories();

  // Delete asset mutation
  const deleteAssetMutation = useDeleteAsset();

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

  // Build columns - no Type column needed since all items in org have same mode
  const baseColumns = [
    {
      accessorKey: "skuKey",
      header: "SKU-Key",
    },
    {
      accessorKey: "name",
      header: "Name",
    },
  ];

  const remainingColumns = [
    {
      accessorKey: "image",
      header: "Image",
      cell: ({ row }: any) => {
        const imageUrl = row.original.image;
        return <Avatar src={`${process.env.NEXT_PUBLIC_RESOURCE_URL}${imageUrl}`} alt="Image" sx={{ borderRadius: "0.4rem", width: 50, height: 50 }} />;
      },
    },
    {
      accessorKey: "category",
      header: "Category",
      cell: ({ row }: any) => <Typography variant="body2">{categories?.find((item: any) => item.id === row.original.categoryId)?.name}</Typography>,
    },
    {
      accessorKey: "stockCount",
      header: isAssetTrackingModeEnabled ? "In Stock" : "Quantity",
      cell: ({ row }: any) => {
        // If tracking mode ON (assets): show inventory count
        // If tracking mode OFF (products): show quantity
        const count = isAssetTrackingModeEnabled
          ? row.original.instockInventoryCount
          : row.original.quantity;
        return (
          <Typography variant="body2">
            {count ?? 0} {isAssetTrackingModeEnabled ? "in stock" : "units"}
          </Typography>
        );
      },
    },
    {
      accessorKey: "action",
      header: "Action",
      cell: ({ row }: any) => (
        <Box sx={{ display: "flex", gap: "var(--default-gap)" }}>
          <IconButton
            onClick={() => router.push(`${ROUTES.ASSETS}/${row.original.skuKey}`)}
            sx={{
              color: "text.secondary",
              "&:hover": { color: "primary.main" },
            }}
          >
            <VisibilityIcon />
          </IconButton>
          <IconButton
            onClick={() => router.push(`${ROUTES.ADD_ASSET}?id=${row.original.id}`)}
            sx={{
              color: "text.secondary",
              "&:hover": { color: "info.main" },
            }}
          >
            <ModeEditIcon />
          </IconButton>
          <IconButton
            onClick={() => {
              setDeleteName(row.original.name);
              setAssetToDelete(row.original.id);
              setConfirmOpen(true);
            }}
            sx={{
              color: "text.secondary",
              "&:hover": { color: "error.main" },
            }}
          >
            <DeleteIcon />
          </IconButton>
        </Box>
      ),
    },
  ];

  // Combine all columns
  const columns = [...baseColumns, ...remainingColumns];

  const filterConfig: FilterField[] = useMemo(
    () => [
      {
        type: "select",
        key: "category",
        label: "Category",
        options: (categories || []).map((c: any) => ({ value: c.id, label: c.name })),
      },
      { type: "dateRange", key: "createdOn", label: "Created On" },
    ],
    [categories],
  );

  return (
    <MainCard>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
        {/* Show title based on organization's tracking mode */}
        <Typography variant="h6">
          {isAssetTrackingModeEnabled ? "Assets" : "Products"}
        </Typography>
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
      </Box>

      {viewMode === "table" ? (
        <PageTable
          loading={isLoading}
          columns={columns}
          data={filteredAssets}
          tableName={isAssetTrackingModeEnabled ? "All Assets" : "All Products"}
          subTitle="Items Detail Information"
          buttonName={isAssetTrackingModeEnabled ? "Add Asset" : "Add Product"}
          page={page}
          limit={limit}
          search={search}
          filters={filters}
          setPage={setPage}
          setLimit={setLimit}
          setSearch={setSearch}
          setFilters={setFilters}
          onAddClick={() => router.push(ROUTES.ADD_ASSET)}
          filterConfig={filterConfig}
          pageCount={Math.ceil(total / limit)}
          totalDocs={total}
        />
      ) : (
        <AssetHierarchyTable
          assets={hierarchyAssets}
          categories={categories}
          loading={isLoading}
          onView={(skuKey) => router.push(`${ROUTES.ASSETS}/${skuKey}`)}
          onEdit={(id) => router.push(`${ROUTES.ADD_ASSET}?id=${id}`)}
          onDelete={(id, name) => {
            setDeleteName(name);
            setAssetToDelete(id);
            setConfirmOpen(true);
          }}
          onAddPart={(parentId) => router.push(`${ROUTES.ADD_ASSET}?parentId=${parentId}`)}
          onAddRootAsset={() => router.push(ROUTES.ADD_ASSET)}
          onRefresh={refetchAssets}
        />
      )}

      {deleteName && (
        <DeleteItemDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          dialogTitle="Confirm Delete"
          dialogDescription="Are you sure you want to delete this asset?"
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
