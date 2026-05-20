import React from "react";
import { Box, Stack, Typography } from "@mui/material";
import { useFormContext, useWatch } from "react-hook-form";
import FormInputBox from "@/form-components/FormInputBox";
import FormSelect from "@/form-components/FormSelect";
import FormImage from "@/form-components/FormImage";
import { useGetCategories } from "../hooks/useGetCategories";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import { UOM_OPTIONS } from "../hooks/useAddAssetFormHandler";

export default function LastStep() {
  const { control } = useFormContext();
  const { categories } = useGetCategories();
  const { isAssetTrackingModeEnabled, isAssetPointsEnabled } = useOrganizationFeatures();
  const itemType = isAssetTrackingModeEnabled ? "Asset" : "Product";
  const customPrices = useWatch({ control, name: "customPrices" }) as { label: string; value: number }[] | undefined;

  return (
    <Stack spacing="var(--default-gap)">
      <FormInputBox control={control} name="name" label="Name" placeHolder={`Enter ${itemType} Name`} disabled />

      <FormInputBox control={control} name="skuKey" label="SKUKEY" placeHolder="Enter SKUKEY" disabled />

      <FormSelect control={control} name="categoryId" label="Category" placeHolder="Add a new category..." addItem={true} menuTitle="Choose a category" menuItems={categories.map((item) => ({ label: item.name, value: item.id }))} disabled />

      <FormSelect control={control} name="uom" label="Unit of Measure" menuTitle="Select UOM" menuItems={UOM_OPTIONS} disabled />

      <FormInputBox control={control} name="description" label="Description" placeHolder={`Enter ${itemType} Description`} disabled />

      {!isAssetTrackingModeEnabled && (
        <FormInputBox control={control} name="quantity" label="Quantity" placeHolder="Enter quantity" type="number" disabled />
      )}

      <FormInputBox control={control} name="costPrice" label="Cost Price" placeHolder="Enter cost price" type="number" disabled />

      <FormInputBox control={control} name="price" label="Selling Price" placeHolder="Enter selling price" type="number" disabled />

      {customPrices && customPrices.filter((cp) => cp && cp.label && cp.label.trim()).length > 0 && (
        <Box>
          <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
            Custom Prices
          </Typography>
          <Stack spacing={0.5}>
            {customPrices
              .filter((cp) => cp && cp.label && cp.label.trim())
              .map((cp, i) => (
                <Stack key={i} direction="row" justifyContent="space-between" sx={{ px: 1 }}>
                  <Typography variant="body2">{cp.label}</Typography>
                  <Typography variant="body2">{Number(cp.value || 0).toFixed(2)}</Typography>
                </Stack>
              ))}
          </Stack>
        </Box>
      )}

      {isAssetPointsEnabled && (
        <FormInputBox control={control} name="points" label="Points" placeHolder="Enter points" type="number" disabled />
      )}

      <FormInputBox control={control} name="minQuantity" label="Minimum Quantity" placeHolder="Enter minimum quantity" type="number" disabled />

      <FormImage control={control} name="image" label="Image" disabled />
    </Stack>
  );
}
