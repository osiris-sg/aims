import React, { useState } from "react";
import { Stack, MenuItem, FormControl, InputLabel, Select, Box } from "@mui/material";
import { useFormContext } from "react-hook-form";
import Table from "@/components/Table"; // Adjust import path if needed

const mockAssets = [
  { id: "asset1", name: "Asset 1" },
  { id: "asset2", name: "Asset 2" },
];

const mockItems = {
  asset1: [
    { id: "item1", name: "Item 1A" },
    { id: "item2", name: "Item 1B" },
  ],
  asset2: [
    { id: "item3", name: "Item 2A" },
    { id: "item4", name: "Item 2B" },
  ],
};

export default function AdditionalDetails() {
  const { control } = useFormContext();
  const [selectedAsset, setSelectedAsset] = useState("");
  const [selectedItem, setSelectedItem] = useState("");
  const [selectedItems, setSelectedItems] = useState<any[]>([]);

  const handleAssetChange = (e: any) => {
    setSelectedAsset(e.target.value);
    setSelectedItem("");
  };

  const handleItemChange = (e: any) => {
    const itemId = e.target.value;
    setSelectedItem(itemId);
    const item = mockItems[selectedAsset]?.find((i) => i.id === itemId);
    if (item && !selectedItems.some((i) => i.id === item.id)) {
      setSelectedItems([...selectedItems, item]);
    }
  };

  const columns = [
    {
      id: "id",
      accessorKey: "id",
      header: "Item ID",
      cell: (info: any) => info.getValue(),
    },
    {
      id: "name",
      accessorKey: "name",
      header: "Item Name",
      cell: (info: any) => info.getValue(),
    },
  ];

  return (
    <Stack spacing={3}>
      <FormControl fullWidth>
        <InputLabel>Asset</InputLabel>
        <Select value={selectedAsset} label="Asset" onChange={handleAssetChange}>
          {mockAssets.map((asset) => (
            <MenuItem key={asset.id} value={asset.id}>
              {asset.name}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <FormControl fullWidth disabled={!selectedAsset}>
        <InputLabel>Item</InputLabel>
        <Select value={selectedItem} label="Item" onChange={handleItemChange}>
          {mockItems[selectedAsset]?.map((item) => (
            <MenuItem key={item.id} value={item.id}>
              {item.name}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <Box>
        <Table columns={columns} data={selectedItems} onRowSelect={() => {}} />
      </Box>
    </Stack>
  );
}
