"use client";

import React, { useState } from "react";
import MainCard from "@/components/MainCard";
import PageTable from "@/components/PageTable";
import { Box, Dialog, DialogTitle, DialogContent, DialogActions, Button, CircularProgress, Typography, IconButton } from "@mui/material";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/routes";
import AddInventoryItem from "./components/AddInventoryItem";
import { useGetInventory, useGetAssets, useDeleteInventory, useGetQrCode } from "@/app/portal/hooks/api";
import QrCode2Icon from "@mui/icons-material/QrCode2";
import ViewQRDialog from "./components/ViewQRDialog";
import VisibilityIcon from "@mui/icons-material/Visibility";
import DeleteIcon from "@mui/icons-material/Delete";

interface Inventory {
  id: string;
  sku: string;
  status: string;
  category: string;
  createdAt: string;
  assetId: string;
  asset: {
    name: string;
    image: string;
  };
}

export default function InventoryPage() {
  const router = useRouter();
  const [openDrawer, setOpenDrawer] = useState(false);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({
    status: "",
    category: "",
    assetId: "",
    createdOn: {
      startDate: null as Date | null,
      endDate: null as Date | null,
    },
  });
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedInventory, setSelectedInventory] = useState<Inventory | null>(null);
  const [selectedSku, setSelectedSku] = useState<string | null>(null);

  // Fetch inventory with new hook
  const { inventories: inventory = [], total = 0, isLoading, refetch } = useGetInventory({ page, limit, search, filters });

  // Fetch assets for dropdown
  const { assets = [] } = useGetAssets({ limit: 1000 });

  // Delete inventory mutation
  const deleteInventoryMutation = useDeleteInventory();

  // QR code hook
  const getQrCodeMutation = useGetQrCode();

  const columns = [
    {
      id: "sku",
      accessorKey: "sku",
      header: "SKU",
      cell: (info: any) => info.getValue(),
    },
    {
      id: "name",
      accessorKey: "assetId",
      header: "Asset Name",
      cell: ({ row }: { row: any }) => {
        const asset = assets?.find((item: any) => item.id === row.original.assetId);
        return <Typography variant="body2">{asset ? asset.name : "N/A"}</Typography>;
      },
    },
    {
      id: "status",
      accessorKey: "status",
      header: "Status",
      cell: (info: any) => info.getValue(),
    },
    {
      id: "category",
      accessorKey: "category",
      header: "Category",
      cell: (info: any) => info.getValue(),
    },
    {
      id: "createdAt",
      accessorKey: "createdAt",
      header: "Created At",
      cell: (info: any) => {
        const value = info.getValue();
        return value ? new Date(value).toLocaleDateString() : "";
      },
    },
    {
      id: "actions",
      accessorKey: "actions",
      header: "Actions",
      cell: (info: any) => (
        <Box sx={{ display: "flex", gap: 1 }}>
          <IconButton
            onClick={() => handleOpenQRDialog(info.row.original.sku)}
            sx={{
              color: "customYellow.contrastText",
              bgcolor: "tertiary.dark",
              "&:hover": {
                bgcolor: "gray",
              },
              borderRadius: "8px",
            }}
          >
            <QrCode2Icon />
          </IconButton>
          <IconButton
            onClick={() => router.push(`${ROUTES.INVENTORY}/${info.row.original.sku}`)}
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
            sx={{
              color: "customRed.contrastText",
              bgcolor: "customRed.main",
              "&:hover": {
                bgcolor: "customRed.dark",
              },
              borderRadius: "8px",
            }}
            onClick={() => {
              setSelectedInventory(info.row.original);
              setDeleteDialogOpen(true);
            }}
          >
            <DeleteIcon />
          </IconButton>
        </Box>
      ),
    },
  ];

  const handleOpenQRDialog = async (sku: string) => {
    setSelectedSku(sku);
    try {
      await getQrCodeMutation.mutateAsync(sku);
    } catch (error) {
      console.error("Error fetching QR code:", error);
    }
  };

  const handleCloseQRDialog = () => {
    setSelectedSku(null);
  };

  const handleDelete = async () => {
    if (!selectedInventory) return;

    try {
      await deleteInventoryMutation.mutateAsync(selectedInventory.id);
      setDeleteDialogOpen(false);
      setSelectedInventory(null);
      refetch();
    } catch (error) {
      console.error("Error deleting inventory:", error);
    }
  };

  const handleAddClick = () => {
    setOpenDrawer(true);
  };

  const handleCloseDrawer = () => {
    setOpenDrawer(false);
  };

  return (
    <MainCard>
      <PageTable
        columns={columns}
        data={inventory}
        tableName="Inventory List"
        subTitle="Items Detail Information"
        buttonName="Add Items"
        onAddClick={handleAddClick}
        loading={isLoading}
        page={page}
        limit={limit}
        search={search}
        filters={filters}
        setPage={setPage}
        setLimit={setLimit}
        setSearch={setSearch}
        setFilters={setFilters}
        availableFilters={["status", "category", "asset", "createdOn"]}
        pageCount={Math.ceil(total / limit)}
        totalDocs={total}
        assetsData={assets || []} // Pass assets data for filter dropdown
      />

      <AddInventoryItem open={openDrawer} onClose={handleCloseDrawer} />

      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>Delete Inventory</DialogTitle>
        <DialogContent>Are you sure you want to delete this inventory item? This action cannot be undone.</DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleDelete} color="error" disabled={deleteInventoryMutation.isPending}>
            {deleteInventoryMutation.isPending ? <CircularProgress size={24} /> : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>

      <ViewQRDialog
        open={!!selectedSku}
        onClose={handleCloseQRDialog}
        qrCode={getQrCodeMutation.data || null}
        isQRLoading={getQrCodeMutation.isPending}
      />
    </MainCard>
  );
}
