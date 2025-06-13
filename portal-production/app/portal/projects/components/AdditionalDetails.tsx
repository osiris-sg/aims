import React, { useState } from "react";
import { Stack, MenuItem, FormControl, InputLabel, Select, Box, IconButton, Skeleton, Typography } from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import { useFormContext } from "react-hook-form";
import Table from "@/components/Table"; // Adjust import path if needed
import useGetAssets from "../hooks/useGetAssets"; // Adjust import path if needed
import useGetInventoryByAsset from "../hooks/useGetInventoryByAsset";

export default function AdditionalDetails() {
  const { control } = useFormContext();
  const [selectedAsset, setSelectedAsset] = useState("");
  const [selectedItem, setSelectedItem] = useState("");
  const [selectedItems, setSelectedItems] = useState<any[]>([]);

  const STATUS_OPTIONS = ["RENTAL", "RESERVED", "MAINTAINANCE", "SOLD"];

  const { assets, isLoading } = useGetAssets();
  const { inventoryData, isLoading: isInventoryLoading } = useGetInventoryByAsset(selectedAsset);
  const inventoryItems = inventoryData.inventories || [];
  console.log("Assets:", assets);
  console.log("Inventory Items:", inventoryItems);

  if (isLoading) {
    return (
      <Stack spacing={2}>
        <Skeleton variant="rectangular" width="100%" height={56} />
        <Skeleton variant="rectangular" width="100%" height={56} />
        <Skeleton variant="rectangular" width="100%" height={200} />
      </Stack>
    );
  }

  const handleAssetChange = (e: any) => {
    setSelectedAsset(e.target.value);
    setSelectedItem("");
  };

  const handleItemChange = (e: any) => {
    const itemId = e.target.value;
    setSelectedItem(itemId);
    const item = inventoryItems.find((i) => i.id === itemId);
    if (item && !selectedItems.some((i) => i.id === item.id)) {
      const newItem = {
        id: item.sku,
        status: "RESERVED",
      };
      console.log("Adding item:", newItem);
      setSelectedItems((prev) => [...prev, newItem]);
    }
  };

  const handleDelete = (id: string) => {
    setSelectedItems((prevItems) => prevItems.filter((item) => item.id !== id));
  };
  const columns = [
    {
      id: "id",
      accessorKey: "id",
      header: "Item SKU",
      cell: (info: any) => info.getValue(),
    },
    {
      id: "status",
      accessorKey: "status",
      header: "Status",
      cell: ({ row }: any) => {
        const handleStatusChange = (event: any) => {
          const newStatus = event.target.value;
          setSelectedItems((prevItems) => prevItems.map((item) => (item.id === row.original.id ? { ...item, status: newStatus } : item)));
        };

        return (
          <Select value={row.original.status} onChange={handleStatusChange} size="small">
            {STATUS_OPTIONS.map((status) => (
              <MenuItem key={status} value={status}>
                {status}
              </MenuItem>
            ))}
          </Select>
        );
      },
    },
    {
      id: "actions",
      header: "Actions",
      cell: ({ row }: any) => (
        <IconButton onClick={() => handleDelete(row.original.id)} aria-label="delete">
          <DeleteIcon />
        </IconButton>
      ),
    },
  ];

  return (
    <Stack spacing={3}>
      <FormControl fullWidth>
        <InputLabel>Asset</InputLabel>
        <Select value={selectedAsset} label="Asset" onChange={handleAssetChange}>
          {assets.docs.map((asset: any) => (
            <MenuItem key={asset.id} value={asset.id}>
              {asset.name}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <FormControl fullWidth disabled={!selectedAsset || isInventoryLoading}>
        <InputLabel>Item</InputLabel>
        {isInventoryLoading ? (
          <Skeleton variant="rectangular" width="100%" height={56} />
        ) : (
          <Select value={selectedItem} label="Item" onChange={handleItemChange}>
            {inventoryItems.map((item) => (
              <MenuItem key={item.id} value={item.id} disabled={selectedItems.some((i) => i.id === item.sku)}>
                {item.sku}
              </MenuItem>
            ))}
          </Select>
        )}
      </FormControl>

      <Box>
        <Table columns={columns} data={selectedItems} onRowSelect={() => {}} />
      </Box>
    </Stack>
  );
}
