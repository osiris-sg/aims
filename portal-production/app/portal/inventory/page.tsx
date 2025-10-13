"use client";

import React, { useState, useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import MainCard from "@/components/MainCard";
import PageTable from "@/components/PageTable";
import { Box, Dialog, DialogTitle, DialogContent, DialogActions, Button, CircularProgress, Typography, IconButton } from "@mui/material";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/routes";
import AddInventoryItem from "./components/AddInventoryItem";
import useGetAssets from "./hooks/useGetAssets";
import useDeleteInventory from "./hooks/useDeleteInventory";
import useViewQRHandler from "./hooks/useViewQRHandler";
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

interface PaginatedResponse {
  docs: Inventory[];
  totalPagesCount: number;
  totalDocuments: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
  limit: number;
  nextPage: number;
}

export default function InventoryPage() {
  const router = useRouter();
  const { organization } = useOrganization();
  const { getToken } = useAuth();
  const organizationId = organization?.id;
  const { assets } = useGetAssets();
  const { deleteInventory, isDeleting } = useDeleteInventory();
  const { qrCode, isQrLoading, openQRDialog, closeQRDialog, selectedSku } = useViewQRHandler();

  const [openDrawer, setOpenDrawer] = useState(false);
  const [inventories, setInventories] = useState<PaginatedResponse>({
    docs: [],
    totalPagesCount: 0,
    totalDocuments: 0,
    hasNextPage: false,
    hasPrevPage: false,
    limit: 10,
    nextPage: 0,
  });
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({
    status: "", // Change from undefined to empty string for consistency
    category: "",
    assetId: "", // Add asset filter
    createdOn: {
      startDate: null as Date | null,
      endDate: null as Date | null,
    },
  });
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedInventory, setSelectedInventory] = useState<Inventory | null>(null);

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
        const asset = assets?.docs?.find((item: any) => item.id === row.original.assetId);
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
            onClick={() => openQRDialog(info.row.original.sku)}
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

  const fetchInventories = async () => {
    if (!organizationId) return;
    setLoading(true);

    try {
      const token = await getToken();
      if (!token) return;

      const response = await request(
        {
          path: "/inventories",
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
        console.log("Inventories response:", response.data);
        setInventories(response.data);
      }
    } catch (error) {
      console.error("Error fetching inventories:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedInventory || !organizationId) return;
    deleteInventory(
      { id: selectedInventory.id },
      {
        onSuccess: () => {
          setDeleteDialogOpen(false);
          setSelectedInventory(null);
        },
      }
    );
  };

  const handleAddClick = () => {
    setOpenDrawer(true);
  };

  const handleCloseDrawer = () => {
    setOpenDrawer(false);
  };

  useEffect(() => {
    fetchInventories();
  }, [page, limit, search, filters, organizationId]);

  return (
    <MainCard>
      <PageTable
        columns={columns}
        data={inventories.docs}
        tableName="Inventory List"
        subTitle="Items Detail Information"
        buttonName="Add Items"
        onAddClick={handleAddClick}
        loading={loading}
        page={page}
        limit={limit}
        search={search}
        filters={filters}
        setPage={setPage}
        setLimit={setLimit}
        setSearch={setSearch}
        setFilters={setFilters}
        availableFilters={["status", "category", "asset", "createdOn"]}
        pageCount={inventories.totalPagesCount}
        totalDocs={inventories.totalDocuments}
        assetsData={assets?.docs || []} // Pass assets data for filter dropdown
      />

      <AddInventoryItem open={openDrawer} onClose={handleCloseDrawer} />

      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>Delete Inventory</DialogTitle>
        <DialogContent>Are you sure you want to delete this inventory item? This action cannot be undone.</DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleDelete} color="error" disabled={isDeleting}>
            {isDeleting ? <CircularProgress size={24} /> : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>

      <ViewQRDialog open={!!selectedSku} onClose={closeQRDialog} qrCode={qrCode} isQRLoading={isQrLoading} />
    </MainCard>
  );
}
