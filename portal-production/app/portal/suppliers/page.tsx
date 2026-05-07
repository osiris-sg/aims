"use client";

import React, { useState } from "react";
import { useGetSuppliers, useDeleteSupplier } from "@/app/portal/hooks/api/useSuppliers";
import MainCard from "@/components/MainCard";
import PageTable from "@/components/PageTable";
import DeleteItemDialogNoConfirm from "@/components/DeleteItemDialogNoConfirm";
import { Box, IconButton } from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import AddSupplier from "./components/AddSupplier";

interface Filters {
  createdOn?: {
    startDate: string | null;
    endDate: string | null;
  };
  [key: string]: any;
}

export default function SuppliersPage() {
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Filters>({
    createdOn: {
      startDate: null,
      endDate: null,
    },
  });
  const [supplierToDelete, setSupplierToDelete] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | undefined>();
  const [isEditMode, setIsEditMode] = useState(false);

  const { suppliers = [], total = 0, isLoading, refetch } = useGetSuppliers({ page, limit, search, filters });

  const deleteSupplierMutation = useDeleteSupplier();

  const columns = [
    {
      id: "supplierCode",
      accessorKey: "supplierCode",
      header: "Supplier Code",
      cell: (info: any) => info.getValue() || "-",
    },
    {
      id: "name",
      accessorKey: "name",
      header: "Name",
      cell: (info: any) => info.getValue(),
    },
    {
      id: "email",
      accessorKey: "email",
      header: "Email",
      cell: (info: any) => info.getValue(),
    },
    {
      id: "phone",
      accessorKey: "phone",
      header: "Phone",
      cell: (info: any) => info.getValue(),
    },
    {
      id: "address",
      accessorKey: "address",
      header: "Address",
      cell: (info: any) => info.getValue(),
    },
    {
      id: "gstRegNo",
      accessorKey: "gstRegNo",
      header: "GST Reg No.",
      cell: (info: any) => info.getValue() || "-",
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
      header: "Actions",
      cell: (info: any) => {
        const supplier = info.row.original;
        return (
          <Box display="flex" gap={1}>
            <IconButton
              onClick={() => handleEditSupplier(supplier.id)}
              sx={{
                color: "text.secondary",
                "&:hover": { color: "info.main" },
              }}
            >
              <EditIcon />
            </IconButton>
            <IconButton
              onClick={() => setSupplierToDelete(supplier.id)}
              sx={{
                color: "text.secondary",
                "&:hover": { color: "error.main" },
              }}
            >
              <DeleteIcon />
            </IconButton>
          </Box>
        );
      },
    },
  ];

  const handleDelete = async () => {
    if (!supplierToDelete) return;

    try {
      await deleteSupplierMutation.mutateAsync(supplierToDelete);
      setSupplierToDelete(null);
      refetch();
    } catch (error) {
      console.error("Error deleting supplier:", error);
    }
  };

  const handleAddSupplier = () => {
    setSelectedSupplierId(undefined);
    setIsEditMode(false);
    setIsDrawerOpen(true);
  };

  const handleEditSupplier = (supplierId: string) => {
    setSelectedSupplierId(supplierId);
    setIsEditMode(true);
    setIsDrawerOpen(true);
  };

  const handleCloseDrawer = () => {
    setIsDrawerOpen(false);
    setSelectedSupplierId(undefined);
    setIsEditMode(false);
  };

  return (
    <MainCard>
      <PageTable
        columns={columns}
        data={suppliers}
        tableName="Suppliers List"
        subTitle="Suppliers Detail Information"
        buttonName="Add Supplier"
        onAddClick={handleAddSupplier}
        loading={isLoading}
        page={page}
        limit={limit}
        search={search}
        filters={filters}
        setPage={setPage}
        setLimit={setLimit}
        setSearch={setSearch}
        setFilters={setFilters}
        availableFilters={["createdOn"]}
        pageCount={Math.ceil(total / limit)}
        totalDocs={total}
      />

      <DeleteItemDialogNoConfirm
        open={!!supplierToDelete}
        onCancel={() => setSupplierToDelete(null)}
        onConfirm={handleDelete}
        loading={deleteSupplierMutation.isPending}
      />

      <AddSupplier
        open={isDrawerOpen}
        onClose={handleCloseDrawer}
        onSuccess={refetch}
        supplierId={selectedSupplierId}
        isEditMode={isEditMode}
      />
    </MainCard>
  );
}
