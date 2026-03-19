/* eslint-disable @typescript-eslint/no-explicit-any */
import FormInputBox from "@/form-components/FormInputBox";
import FormSelect from "@/form-components/FormSelect";
import { Drawer, Typography, Stack, Button, useTheme, TextField, Box, CircularProgress } from "@mui/material";
import useAddInventoryFormHandler from "../hooks/useAddInventoryFormHandler";
import { INVENTORY_STATUS } from "../constants";
import useGetCountries from "../hooks/useGetCountries";
import { useEffect, useState, useCallback } from "react";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";

interface AddInventoryItemProps {
  open: boolean;
  onClose: () => void;
}

function SkuField({ index, value, onChange }: { index: number; value: string; onChange: (index: number, value: string) => void }) {
  const [localValue, setLocalValue] = useState(value);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  return (
    <TextField
      size="small"
      value={localValue}
      onChange={(e) => {
        setLocalValue(e.target.value);
        onChange(index, e.target.value);
      }}
      fullWidth
      sx={{ "& .MuiInputBase-input": { py: 0.75, px: 1, fontSize: "0.875rem" } }}
    />
  );
}

export default function AddInventoryItem({ open, onClose }: AddInventoryItemProps) {
  const { control, handleSubmit, onSubmit, assets, isSkuLoading, isInvetoryUpdating, skuRange, reset } = useAddInventoryFormHandler({
    onSuccess: onClose,
  });
  const { countries } = useGetCountries();
  const { isEditInventorySkuEnabled } = useOrganizationFeatures();
  const theme = useTheme();
  const [editedSkus, setEditedSkus] = useState<string[]>([]);

  // Sync editedSkus with skuRange
  useEffect(() => {
    if (skuRange.length > 0) {
      setEditedSkus([...skuRange]);
    }
  }, [skuRange]);

  // Reset form when drawer closes
  useEffect(() => {
    if (!open) {
      reset();
      setEditedSkus([]);
    }
  }, [open, reset]);

  const handleClose = () => {
    reset();
    setEditedSkus([]);
    onClose();
  };

  const handleSkuChange = useCallback((index: number, value: string) => {
    setEditedSkus((prev) => {
      const updated = [...prev];
      updated[index] = value;
      return updated;
    });
  }, []);

  const handleFormSubmit = handleSubmit((data) => {
    // If editing is enabled and user modified SKUs, pass as customSku
    if (isEditInventorySkuEnabled && editedSkus.length > 0) {
      const autoSku = skuRange.join(",");
      const editedSku = editedSkus.join(",");
      if (editedSku !== autoSku) {
        data.sku = editedSku;
      }
    }
    onSubmit(data);
  });

  const showIndividualSkus = isEditInventorySkuEnabled && editedSkus.length > 0;

  return (
    <Drawer anchor="right" open={open} onClose={handleClose} sx={{ "& .MuiDrawer-paper": { width: "400px", backgroundColor: theme.palette.tertiary.contrastText } }}>
      <Stack direction="column" gap="var(--double-gap)" padding="var(--default-padding)" height="100%" width="100%" display="flex" alignItems="center" justifyContent="center">
        <Typography variant="body1" sx={{ width: "100%" }}>
          Add Items
        </Typography>
        <form style={{ width: "100%" }} onSubmit={handleFormSubmit}>
          <Stack direction="column" gap="var(--default-gap)" width="100%">
            <FormSelect control={control} name="assetId" label="Asset" addItem={false} menuTitle="Choose an asset" menuItems={assets?.docs?.map((asset: any) => ({ label: asset.name, value: asset.id })) || []} />
            {showIndividualSkus ? (
              <Box>
                <Typography variant="caption" sx={{ mb: 0.5, display: "block", color: "text.secondary" }}>
                  SKU Keys
                </Typography>
                {isSkuLoading ? (
                  <Box sx={{ display: "flex", justifyContent: "center", py: 1 }}>
                    <CircularProgress size={20} />
                  </Box>
                ) : (
                  <Stack direction="column" gap={0.75} sx={{ maxHeight: 200, overflowY: "auto", pr: 0.5 }}>
                    {editedSkus.map((sku, index) => (
                      <Box key={index} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <Typography variant="caption" sx={{ minWidth: 20, color: "text.secondary" }}>
                          {index + 1}.
                        </Typography>
                        <SkuField index={index} value={sku} onChange={handleSkuChange} />
                      </Box>
                    ))}
                  </Stack>
                )}
              </Box>
            ) : (
              <FormInputBox loading={isSkuLoading} control={control} name="sku" label="SKU" placeHolder="Enter SKU" disabled={true} />
            )}
            <FormInputBox control={control} name="quantity" label="Quantity" placeHolder="Enter quantity" type="number" min={1} integerOnly={true} />
            <FormInputBox control={control} name="category" label="Category" placeHolder="Enter a category" disabled={true} />
            <FormSelect control={control} name="location" label="Location" addItem={false} menuTitle="Choose a location" menuItems={countries} />
            <FormSelect control={control} name="status" label="Status" addItem={false} menuTitle="Choose status" menuItems={INVENTORY_STATUS} />
          </Stack>
          <Stack
            direction="row"
            width="100%"
            sx={{
              justifyContent: "space-between",
              py: "var(--quarter-gap)",
              mt: "var(--double-gap)",
            }}
          >
            <Button variant="outlined" type="button" onClick={handleClose} disabled={isSkuLoading || isInvetoryUpdating}>
              Cancel
            </Button>

            <Button variant="contained" type="submit" disabled={isSkuLoading || isInvetoryUpdating}>
              {isInvetoryUpdating ? "Saving..." : "Save"}
            </Button>
          </Stack>
        </form>
      </Stack>
    </Drawer>
  );
}
