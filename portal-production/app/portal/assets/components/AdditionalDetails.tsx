import React from "react";
import { Stack } from "@mui/material";
import FormInputBox from "@/form-components/FormInputBox";
import FormImage from "@/form-components/FormImage";
import { useFormContext } from "react-hook-form";
import ParentAssetSelector from "./ParentAssetSelector";
import { useSearchParams } from "next/navigation";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";

export default function AdditionalDetails() {
  const { control, setValue, watch } = useFormContext();
  const searchParams = useSearchParams();
  const editingAssetId = searchParams.get("id");
  const parentAssetId = watch("parentAssetId");

  // Get organization's tracking mode - ON = Assets, OFF = Products
  const { isAssetTrackingModeEnabled } = useOrganizationFeatures();
  const itemType = isAssetTrackingModeEnabled ? "Asset" : "Product";

  return (
    <Stack spacing="var(--default-gap)">
      <FormInputBox control={control} name="description" label="Description" placeHolder={`Enter ${itemType} Description`} />

      <FormInputBox
        control={control}
        name="price"
        label="Price"
        placeHolder="Enter price"
        type="number"
        min={0}
        bottomText={`Unit price for this ${itemType.toLowerCase()}`}
      />

      <FormInputBox
        control={control}
        name="minQuantity"
        label="Minimum Quantity"
        placeHolder="Enter minimum quantity"
        type="number"
        min={0}
        bottomText="Low stock alert threshold"
      />

      {/* Parent selector only shown for tracked assets - products don't have hierarchy */}
      {isAssetTrackingModeEnabled && (
        <ParentAssetSelector
          value={parentAssetId}
          onChange={(newParentId) => setValue("parentAssetId", newParentId)}
          excludeAssetId={editingAssetId || undefined}
        />
      )}

      <FormImage control={control} name="image" label="Image" />
    </Stack>
  );
}
 