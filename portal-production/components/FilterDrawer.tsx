/* eslint-disable @typescript-eslint/no-explicit-any */
import { Box, Button, Drawer, Stack, useTheme } from "@mui/material";
import React, { useEffect, useState } from "react";

import { useForm } from "react-hook-form";

import DateRangePicker from "@/form-components/FormDateRangePicker";
import FormSelect from "@/form-components/FormSelect";
import { useSelector } from "react-redux";
import { selectCategories as inventoryCategories } from "@/containers/Inventory/slice/selectors";
import { INVENTORY_STATUS } from "@/containers/Inventory/slice/constants";
import { selectCategories as assetCategories } from "@/containers/Assets/slice/selectors";

interface FilterDrawerProps {
  openFilterDrawerStatus: boolean;
  defaultFilters: any;
  onClose: () => void;
  onSetFilters: (filters: any) => void;
  availableFilterTypes?: string[];
  assetsData?: any[]; // Add assets data prop
}

export default function FilterDrawer(props: FilterDrawerProps) {
  const { openFilterDrawerStatus = false, onClose, onSetFilters, defaultFilters, availableFilterTypes, assetsData = [] } = props;
  const theme = useTheme();

  const inventoryCats = useSelector(inventoryCategories);
  const assetCats = useSelector(assetCategories);

  // Use the first non-empty array, or default to empty array if both are empty
  const categories = inventoryCats && inventoryCats.length > 0 ? inventoryCats : assetCats && assetCats.length > 0 ? assetCats : [];

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [disableSubmit, setDisableSubmit] = useState(false);
  const { watch, control, setValue } = useForm();
  const [filters, setFilters] = useState(() => {
    // Start with a copy of defaultFilters
    const initialFilters = { ...defaultFilters };

    // Only include createdOn if it exists in defaultFilters
    if (defaultFilters.createdOn) {
      initialFilters.createdOn = {
        startDate: defaultFilters.createdOn.startDate,
        endDate: defaultFilters.createdOn.endDate,
      };
    }

    if (defaultFilters.status) {
      initialFilters.status = defaultFilters.status;
      setValue("status", defaultFilters.status);
    }
    if (defaultFilters.category) {
      initialFilters.category = defaultFilters.category;
      setValue("category", defaultFilters.category);
    }
    if (defaultFilters.assetId) {
      initialFilters.assetId = defaultFilters.assetId;
      setValue("assetId", defaultFilters.assetId);
    }

    return initialFilters;
  });

  const categoryList = categories.map((category) => ({ value: category.id, label: category.name }));
  const assetList = assetsData.map((asset) => ({ value: asset.id, label: asset.name }));
  const selectedCategory = watch("category");
  const selectedStatus = watch("status");
  const selectedAsset = watch("assetId");
  const handleApplyFilters = () => {
    onSetFilters(filters);
    onClose();
  };

  const [datePickerKey, setDatePickerKey] = useState(0);

  const handleResetAllFilters = () => {
    // Reset the form values
    setValue("status", "");
    setValue("category", "");
    setValue("assetId", "");

    // Reset the filters state
    const resetFilters = {
      ...defaultFilters,
      createdOn: { startDate: null, endDate: null },
      status: "",
      category: "",
      assetId: "",
    };

    setFilters(resetFilters);

    // Force re-render of the DateRangePicker by updating its key
    // This is needed because the DateRangePicker might maintain internal state
    setDatePickerKey((prev) => prev + 1);
  };

  useEffect(() => {
    setFilters((prev: any) => ({
      ...prev,
      category: selectedCategory || "",
      status: selectedStatus || "",
      assetId: selectedAsset || "",
    }));
  }, [selectedCategory, selectedStatus, selectedAsset]);

  return (
    <Drawer anchor="right" open={openFilterDrawerStatus} onClose={onClose} sx={{ "& .MuiDrawer-paper": { width: "450px", backgroundColor: theme.palette.tertiary.contrastText } }}>
      <Stack direction="column" gap="var(--default-gap)" padding="var(--default-padding)" height="100%" width="100%" display="flex" alignItems="center" justifyContent="center">
        <Box sx={{ width: "100%", color: theme.palette.text.primary, display: "flex", justifyContent: "space-between" }}>
          Filter data by:
          {availableFilterTypes && availableFilterTypes.length > 1 ? (
            <Button variant="text" onClick={handleResetAllFilters} sx={{ p: 0 }}>
              Reset all
            </Button>
          ) : null}
        </Box>
        {availableFilterTypes?.includes("createdOn") && (
          <DateRangePicker key={datePickerKey} label="Created On" onConfirm={(value) => setFilters({ ...filters, createdOn: { startDate: value.startDate, endDate: value.endDate } })} value={{ startDate: filters.createdOn.startDate, endDate: filters.createdOn.endDate }} />
        )}

        {availableFilterTypes?.includes("status") && (
          <Box width="100%" sx={{ position: "relative" }}>
            <FormSelect control={control} menuItems={INVENTORY_STATUS} label="Status" name="status" menuTitle="Status" size="small" defaultValue={filters?.status} />
            <Button
              sx={{ position: "absolute", top: 0, right: 0, p: 0 }}
              onClick={() => {
                setValue("status", "");
              }}
            >
              Reset filter
            </Button>
          </Box>
        )}
        {availableFilterTypes?.includes("category") && (
          <Box width="100%" sx={{ position: "relative" }}>
            <FormSelect control={control} menuItems={categoryList} label="Category" name="category" menuTitle="Category" size="small" defaultValue={filters.category} />
            <Button
              sx={{ position: "absolute", top: 0, right: 0, p: 0 }}
              onClick={() => {
                setValue("category", "");
              }}
            >
              Reset filter
            </Button>
          </Box>
        )}
        {availableFilterTypes?.includes("asset") && (
          <Box width="100%" sx={{ position: "relative" }}>
            <FormSelect control={control} menuItems={assetList} label="Asset" name="assetId" menuTitle="Asset" size="small" defaultValue={filters.assetId} />
            <Button
              sx={{ position: "absolute", top: 0, right: 0, p: 0 }}
              onClick={() => {
                setValue("assetId", "");
              }}
            >
              Reset filter
            </Button>
          </Box>
        )}

        <Stack direction="row" width="100%" spacing={1}>
          <Button
            variant="outlined"
            type="button"
            onClick={() => {
              setFilters(defaultFilters);
              onClose();
            }}
            sx={{ flex: 1 }}
          >
            Cancel
          </Button>

          <Button variant="contained" type="button" onClick={handleApplyFilters} disabled={disableSubmit} sx={{ flex: 1 }}>
            Apply filters
          </Button>
        </Stack>
      </Stack>
    </Drawer>
  );
}
