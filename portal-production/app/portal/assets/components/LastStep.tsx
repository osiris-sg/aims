import React from "react";
import { Stack } from "@mui/material";
import { useFormContext } from "react-hook-form";
import FormInputBox from "@/form-components/FormInputBox";
import FormSelect from "@/form-components/FormSelect";
import FormImage from "@/form-components/FormImage";
import { useGetCategories } from "../hooks/useGetCategories";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import { UOM_OPTIONS } from "../hooks/useAddAssetFormHandler";

export default function LastStep() {
  const { control } = useFormContext();
  const { categories } = useGetCategories();
  const { isAssetTrackingModeEnabled } = useOrganizationFeatures();
  const itemType = isAssetTrackingModeEnabled ? "Asset" : "Product";

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

      <FormInputBox control={control} name="price" label="Price" placeHolder="Enter price" type="number" disabled />

      <FormInputBox control={control} name="minQuantity" label="Minimum Quantity" placeHolder="Enter minimum quantity" type="number" disabled />

      <FormImage control={control} name="image" label="Image" disabled />
    </Stack>
  );
}
