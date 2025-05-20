"use client";

import React, { useState, useEffect } from "react";
import { useOrganization, useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";
import MainCard from "@/components/MainCard";
import PageTable from "@/components/PageTable";
import { Box, Dialog, DialogTitle, DialogContent, DialogActions, Button, CircularProgress } from "@mui/material";
import { useRouter } from "next/navigation";

interface Inventory {
  id: string;
  sku: string;
  status: string;
  category: string;
  createdAt: string;
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
    status: "",
    category: "",
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
      accessorKey: "asset.name",
      header: "Name",
      cell: (info: any) => info.getValue(),
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
          <Button variant="contained" size="small" onClick={() => router.push(`/src/inventory/${info.row.original.sku}`)}>
            View
          </Button>
          <Button
            variant="outlined"
            color="error"
            size="small"
            onClick={() => {
              setSelectedInventory(info.row.original);
              setDeleteDialogOpen(true);
            }}
          >
            Delete
          </Button>
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
    setLoading(true);

    try {
      const token = await getToken();
      if (!token) return;

      const response = await request(
        {
          path: `/inventories/sku/${selectedInventory.sku}`,
          method: "DELETE",
        },
        {},
        token
      );

      if (response.success) {
        setDeleteDialogOpen(false);
        fetchInventories();
      }
    } catch (error) {
      console.error("Error deleting inventory:", error);
    } finally {
      setLoading(false);
    }
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
        onAddClick={() => router.push("/src/inventory/add")}
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

      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>Delete Inventory</DialogTitle>
        <DialogContent>Are you sure you want to delete this inventory item? This action cannot be undone.</DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleDelete} color="error" disabled={loading}>
            {loading ? <CircularProgress size={24} /> : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>
    </MainCard>
  );
}
