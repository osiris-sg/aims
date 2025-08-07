import React from "react";
import { Stack } from "@mui/material";
import FormInputBox from "@/form-components/FormInputBox";
import FormImage from "@/form-components/FormImage";
import { useFormContext } from "react-hook-form";
import ParentAssetSelector from "./ParentAssetSelector";
import { useSearchParams } from "next/navigation";

export default function AdditionalDetails() {
  const { control, setValue, watch } = useFormContext();
  const searchParams = useSearchParams();
  const editingAssetId = searchParams.get("id");
  const parentAssetId = watch("parentAssetId");

  return (
    <Stack spacing="var(--default-gap)">
      <FormInputBox control={control} name="description" label="Description" placeHolder="Enter Asset Description" />

      <ParentAssetSelector
        value={parentAssetId}
        onChange={(newParentId) => setValue("parentAssetId", newParentId)}
        excludeAssetId={editingAssetId || undefined}
      />

      <FormImage control={control} name="image" label="Image" />
    </Stack>
  );
}
 