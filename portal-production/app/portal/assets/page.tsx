"use client";
import React, { useState, useEffect } from "react";
import MainCard from "@/components/MainCard";
import PageTable from "@/components/PageTable";
import { useRouter } from "next/navigation";
import { Avatar, IconButton, Typography, Box } from "@mui/material";
import VisibilityIcon from "@mui/icons-material/Visibility";
import ModeEditIcon from "@mui/icons-material/ModeEdit";
import DeleteIcon from "@mui/icons-material/Delete";
import DeleteItemDialog from "@/components/DeleteItemDialog";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import { ROUTES } from "@/routes";
import AssetHierarchyTable from "./components/AssetHierarchyTable";
import { ToggleButton, ToggleButtonGroup } from "@mui/material";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import ViewListIcon from "@mui/icons-material/ViewList";

export default function AssetsPage() {
  const router = useRouter();
  const { organization } = useOrganization();
  const { getToken } = useAuth();
  const organizationId = organization?.id;

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({ status: "", category: "" });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteName, setDeleteName] = useState<string | null>(null);
  const [assetToDelete, setAssetToDelete] = useState<string | null>(null);
  const [assets, setAssets] = useState<any>({ docs: [], totalDocuments: 0, totalPagesCount: 0 });
  const [hierarchyAssets, setHierarchyAssets] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [viewMode, setViewMode] = useState<"table" | "hierarchy">("table");

  const fetchAssets = React.useCallback(async () => {
    if (!organizationId) return;

    setIsLoading(true);
    try {
      const token = await getToken();
      if (!token) return;

      const response = await request(
        {
          path: `/assets`,
          method: "POST",
        },
        {
          page,
          limit,
          search,
          filters,
          organizationId,
        },
        token
      );

      if (response.success) {
        setAssets(response.data);
      }
    } catch (error) {
      console.error("Error fetching assets:", error);
    } finally {
      setIsLoading(false);
    }
  }, [organizationId, getToken, page, limit, search, filters]);

  const fetchHierarchyAssets = React.useCallback(async () => {
    if (!organizationId) return;

    setIsLoading(true);
    try {
      const token = await getToken();
      if (!token) return;

      const response = await request(
        {
          path: `/assets/hierarchy`,
          method: "GET",
        },
        {},
        token
      );

      if (response.success) {
        setHierarchyAssets(response.data);
      }
    } catch (error) {
      console.error("Error fetching hierarchy assets:", error);
    } finally {
      setIsLoading(false);
    }
  }, [organizationId, getToken]);

  const fetchCategories = React.useCallback(async () => {
    if (!organizationId) return;

    try {
      const token = await getToken();
      if (!token) return;

      const response = await request(
        {
          path: `/categories`,
          method: "GET",
        },
        { organizationId },
        token
      );

      if (response.success) {
        setCategories(response.data);
      }
    } catch (error) {
      console.error("Error fetching categories:", error);
    }
  }, [organizationId, getToken]);

  const deleteAsset = async () => {
    if (!assetToDelete || !organizationId) return;

    try {
      const token = await getToken();
      if (!token) return;

      const response = await request(
        {
          path: `/assets/delete`,
          method: "DELETE",
        },
        { id: assetToDelete },
        token
      );

      if (response.success) {
        setConfirmOpen(false);
        setAssetToDelete(null);
        fetchAssets();
      }
    } catch (error) {
      console.error("Error deleting asset:", error);
    }
  };

  useEffect(() => {
    if (viewMode === "table") {
      fetchAssets();
    } else {
      fetchHierarchyAssets();
    }
  }, [viewMode, page, limit, search, filters, organizationId, fetchAssets, fetchHierarchyAssets]);

  useEffect(() => {
    fetchCategories();
  }, [organizationId, fetchCategories]);

  const columns = [
    {
      accessorKey: "skuKey",
      header: "SKU-Key",
    },
    {
      accessorKey: "name",
      header: "Asset Name",
    },
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
      accessorKey: "instockInventoryCount",
      header: "Status-In Stock",
    },
    {
      accessorKey: "status",
      header: "Status",
    },
    {
      accessorKey: "action",
      header: "Action",
      cell: ({ row }: any) => (
        <Box sx={{ display: "flex", gap: "var(--default-gap)" }}>
          <IconButton
            onClick={() => router.push(`${ROUTES.ASSETS}/${row.original.skuKey}`)}
            sx={{
              color: "customYellow.contrastText",
              bgcolor: "customYellow.main",
              "&:hover": {
                bgcolor: "customYellow.dark",
              },
              borderRadius: "8px",
            }}
          >
            <VisibilityIcon />
          </IconButton>
          <IconButton
            onClick={() => router.push(`${ROUTES.ADD_ASSET}?id=${row.original.id}`)}
            sx={{
              borderRadius: "8px",
              color: "secondary.contrastText",
              bgcolor: "secondary.main",
              "&:hover": {
                bgcolor: "secondary.dark",
              },
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
              color: "customRed.contrastText",
              bgcolor: "customRed.main",
              "&:hover": {
                bgcolor: "customRed.dark",
              },
              borderRadius: "8px",
            }}
          >
            <DeleteIcon />
          </IconButton>
        </Box>
      ),
    },
  ];

  return (
    <MainCard>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
        <Typography variant="h5">All Assets</Typography>
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
          onAddClick={() => router.push(ROUTES.ADD_ASSET)}
          availableFilters={["status", "category"]}
          pageCount={assets.totalPagesCount}
          totalDocs={assets.totalDocuments}
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
