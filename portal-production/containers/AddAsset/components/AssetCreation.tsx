import FormInputBox from "@/form-components/FormInputBox";
import FormSelect from "@/form-components/FormSelect";
import { Stack } from "@mui/material";
import React from "react";
import { useFormContext } from "react-hook-form";
import useAddCategoryHandler from "../hooks/useAddCategoryHandler";

export default function AssetCreation() {
  const { control } = useFormContext();
  const { handleAddCategory, handleDeleteCategory, categories, categoriesLoading, deleteCategoryLoading, isSkuCheckInProgress } = useAddCategoryHandler();

  return (
    <Stack direction="column" spacing="var(--default-gap)">
      <FormInputBox control={control} name="name" label="Name" placeHolder="Enter Asset Name" required />

      <FormInputBox control={control} name="skuKey" label="SKUKEY" placeHolder="Enter SKUKEY" bottomText="Unique identifier for different assets" required loading={isSkuCheckInProgress} />

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
    </Stack>
  );
}
