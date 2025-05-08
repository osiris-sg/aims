import React from "react";
import { Stack } from "@mui/material";
import FormInputBox from "@/form-components/FormInputBox";
import FormImage from "@/form-components/FormImage";
import { useFormContext } from "react-hook-form";

export default function AdditionalDetails() {
  const { control } = useFormContext();

  return (
    <Stack spacing="var(--default-gap)">
      <FormInputBox control={control} name="description" label="Description" placeHolder="Enter Asset Description" />

      <FormImage control={control} name="image" label="Image" />
    </Stack>
  );
}
