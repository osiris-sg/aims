import React, { useState, useEffect } from "react";
import { Stack, MenuItem, FormControl, InputLabel, Select, Box, IconButton, Skeleton, Typography } from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import { useFormContext } from "react-hook-form";
import Table from "@/components/Table"; // Adjust import path if needed
import useGetAssets from "../hooks/useGetAssets"; // Adjust import path if needed
import useGetInventoryByAsset from "../hooks/useGetInventoryByAsset";
import DateRangePicker from "@/form-components/FormDateRangePicker";
import FormDatePicker from "@/form-components/FormDatePicker";

export default function AdditionalDetails() {
  const { control, setValue, getValues } = useFormContext();
  const [selectedAsset, setSelectedAsset] = useState("");
  const [selectedItem, setSelectedItem] = useState("");
  const [selectedItems, setSelectedItems] = useState<any[]>([]);

  const STATUS_OPTIONS = ["RENTAL", "RESERVED", "MAINTAINANCE", "SOLD"];

  const { assets, isLoading } = useGetAssets();
  const { inventoryData, isLoading: isInventoryLoading } = useGetInventoryByAsset(selectedAsset);
  const inventoryItems = inventoryData.inventories || [];
  console.log("Assets:", assets);
  console.log("Inventory Items:", inventoryItems);

  // Sync selectedItems from form context assignments on mount or update
  useEffect(() => {
    const formAssignments = getValues("assignments") || [];
    console.log("Form Assignments:", formAssignments);
    const mappedItems = formAssignments.map((assignment: any) => ({
      id: assignment.skuKey,
      status: assignment.status,
      startDate: assignment.startDate,
      endDate: assignment.endDate,
    }));
    setSelectedItems(mappedItems);
  }, [getValues]);

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
        startDate: null,
        endDate: null,
      };
      console.log("Adding item:", newItem);
      setSelectedItems((prev) => [...prev, newItem]);
      setValue("assignments", [
        ...(getValues("assignments") || []),
        {
          inventoryId: item.id,
          skuKey: item.sku,
          startDate: null,
          endDate: null,
          status: "RESERVED",
        },
      ]);
    }
  };

  const handleDelete = (id: string) => {
    setSelectedItems((prevItems) => prevItems.filter((item) => item.id !== id));
    const currentAssignments = getValues("assignments") || [];
    const updatedAssignments = currentAssignments.filter((assignment: any) => assignment.skuKey !== id);
    setValue("assignments", updatedAssignments);
    setSelectedItem("");
  };
  const columns = [
    {
      id: "id",
      accessorKey: "id",
      header: "Item SKU",
      cell: (info: any) => info.getValue(),
    },
    {
      id: "startDate",
      accessorKey: "startDate",
      header: "Start Date",
      cell: ({ row }: any) => {
        const handleStartDateChange = (newDate: any) => {
          setSelectedItems((prevItems) => prevItems.map((item) => (item.id === row.original.id ? { ...item, startDate: newDate } : item)));
        };

        return (
          <Box sx={{ minWidth: 150 }}>
            <FormDatePicker control={control} name={`assignments.${selectedItems.findIndex((item) => item.id === row.original.id)}.startDate`} defaultValue={row.original.startDate || null} size="small" />
          </Box>
        );
      },
    },
    {
      id: "endDate",
      accessorKey: "endDate",
      header: "End Date",
      cell: ({ row }: any) => {
        const handleEndDateChange = (newDate: any) => {
          setSelectedItems((prevItems) => prevItems.map((item) => (item.id === row.original.id ? { ...item, endDate: newDate } : item)));
        };

        return (
          <Box sx={{ minWidth: 150 }}>
            <FormDatePicker control={control} name={`assignments.${selectedItems.findIndex((item) => item.id === row.original.id)}.endDate`} defaultValue={row.original.endDate || null} size="small" />
          </Box>
        );
      },
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
          <Box sx={{ minWidth: 120 }}>
            <Select value={row.original.status} onChange={handleStatusChange} size="small" fullWidth>
              {STATUS_OPTIONS.map((status) => (
                <MenuItem key={status} value={status}>
                  {status}
                </MenuItem>
              ))}
            </Select>
          </Box>
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
