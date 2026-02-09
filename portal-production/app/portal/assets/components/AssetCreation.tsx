import FormInputBox from "@/form-components/FormInputBox";
import FormSelect from "@/form-components/FormSelect";
import { Stack, Skeleton } from "@mui/material";
import React, { useEffect } from "react";
import { useFormContext } from "react-hook-form";
import { useAddCategoryHandler } from "../hooks/useAddCategoryHandler";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import { UOM_OPTIONS } from "../hooks/useAddAssetFormHandler";

export default function AssetCreation() {
  const { control, setValue } = useFormContext();
  const { handleAddCategory, handleDeleteCategory, categories, categoriesLoading, deleteCategoryLoading } = useAddCategoryHandler();
  const { isAssetTrackingModeEnabled, isLoading: featuresLoading } = useOrganizationFeatures();

  // Set isTracked based on organization setting (not user choice)
  // ON = tracked assets, OFF = untracked products
  useEffect(() => {
    if (!featuresLoading) {
      setValue("isTracked", isAssetTrackingModeEnabled);
    }
  }, [isAssetTrackingModeEnabled, featuresLoading, setValue]);

  return (
    <Stack direction="column" spacing="var(--default-gap)">
      <FormInputBox control={control} name="name" label="Name" placeHolder={isAssetTrackingModeEnabled ? "Enter Asset Name" : "Enter Product Name"} required />

      <FormInputBox control={control} name="skuKey" label="SKUKEY" placeHolder="Enter SKUKEY" bottomText={isAssetTrackingModeEnabled ? "Unique identifier for different assets" : "Unique identifier for different products"} required />

      <FormSelect
        control={control}
        name="categoryId"
        label="Category"
        placeHolder="Add a new category..."
        addItem={true}
        menuTitle="Choose a category"
        menuItems={categories.map((item) => ({ label: item.name, value: item.id }))}
        required
        handleAddItem={handleAddCategory}
        handleDeleteItem={(id) => {
          void handleDeleteCategory(id as string);
        }}
        isAdding={categoriesLoading}
        isDeleting={deleteCategoryLoading}
      />

      <FormSelect
        control={control}
        name="uom"
        label="Unit of Measure"
        menuTitle="Select UOM"
        menuItems={UOM_OPTIONS}
        required
      />

      {/* Quantity Field - Only shown for untracked products (when feature is OFF) */}
      {featuresLoading ? (
        <Skeleton variant="rectangular" height={80} sx={{ borderRadius: 2 }} />
      ) : !isAssetTrackingModeEnabled && (
        <FormInputBox
          control={control}
          name="quantity"
          label="Quantity"
          placeHolder="Enter initial quantity"
          bottomText="Set the starting stock quantity for this product"
          type="number"
          min={0}
          required
        />
      )}
    </Stack>
  );
}
 