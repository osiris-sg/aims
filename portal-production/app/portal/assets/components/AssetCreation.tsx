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

  // Always create assets as untracked (product mode) initially.
  // They become tracked when inventory items are added.
  useEffect(() => {
    if (!featuresLoading) {
      setValue("isTracked", false);
    }
  }, [featuresLoading, setValue]);

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

      {/* Quantity Field - optional starting stock (defaults to 0 if left blank). */}
      <FormInputBox
        control={control}
        name="quantity"
        label="Quantity"
        placeHolder="Enter starting stock (optional)"
        bottomText="Optional starting stock quantity — leave blank to start at 0"
        type="number"
        min={0}
      />
    </Stack>
  );
}
 