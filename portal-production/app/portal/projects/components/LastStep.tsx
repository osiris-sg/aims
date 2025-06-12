import React from "react";
import { Stack } from "@mui/material";
import { useFormContext } from "react-hook-form";
import FormInputBox from "@/form-components/FormInputBox";
import FormSelect from "@/form-components/FormSelect";
import FormImage from "@/form-components/FormImage";
import { useGetCategories } from "../hooks/useGetCustomers";

export default function LastStep() {
  const { control } = useFormContext();
  const { categories } = useGetCategories();

  return (
    <Stack spacing="var(--default-gap)">
      <FormInputBox control={control} name="name" label="Name" placeHolder="Enter Asset Name" disabled />

      <FormInputBox control={control} name="skuKey" label="SKUKEY" placeHolder="Enter SKUKEY" disabled />

      <FormSelect control={control} name="categoryId" label="Category" placeHolder="Add a new category..." addItem={true} menuTitle="Choose a category" menuItems={categories.map((item) => ({ label: item.name, value: item.id }))} disabled />

      <FormInputBox control={control} name="description" label="Description" placeHolder="Enter Asset Description" disabled />

      <FormImage control={control} name="image" label="Image" disabled />
    </Stack>
  );
}
