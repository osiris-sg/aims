/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useState } from "react";
import FormAutocomplete from "@/form-components/FormAutocomplete";
import { Control, useWatch, UseFormSetValue } from "react-hook-form";
import { useGetAssets } from "./useGetAssets";
import { usePastDescriptions } from "./usePastDescriptions";

interface DescriptionCellProps {
  rowIndex: number;
  control: Control<any>;
  setValue: UseFormSetValue<any>;
  viewMode: boolean;
  rentedInventories: any[];
  disabled?: boolean;
}

const DescriptionCell: React.FC<DescriptionCellProps> = ({ rowIndex, control, setValue, viewMode, rentedInventories, disabled }) => {
  const { assets } = useGetAssets();
  const inventoryItemId = useWatch({ control, name: `items.${rowIndex}.inventoryItemId` });
  const [hasBeenEdited, setHasBeenEdited] = useState(false);
  const { pastDescriptions, isLoading: isLoadingDescriptions } = usePastDescriptions();

  useEffect(() => {
    const selectedInventory = rentedInventories.find((inv) => inv.id === inventoryItemId);
    const relatedAsset = assets?.docs?.find((asset: { id: any }) => asset.id === selectedInventory?.assetId);

    // Only auto-populate if the description hasn't been manually edited
    if (relatedAsset?.description && !hasBeenEdited) {
      setValue(`items.${rowIndex}.description`, relatedAsset.description);
    }
  }, [inventoryItemId, rentedInventories, assets, rowIndex, setValue, hasBeenEdited]);

  // Watch for manual changes to the description field
  const descriptionValue = useWatch({ control, name: `items.${rowIndex}.description` });

  useEffect(() => {
    if (descriptionValue && !hasBeenEdited) {
      setHasBeenEdited(true);
    }
  }, [descriptionValue, hasBeenEdited]);

  return (
    <div
      style={{
        width: "100%",
        maxWidth: "100%",
        minWidth: 0,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <FormAutocomplete
        control={control}
        name={`items.${rowIndex}.description`}
        placeHolder="Enter or select description"
        rows={1}
        size="small"
        labelArriangment={viewMode ? "horizontal" : "vertical"}
        viewMode={viewMode}
        disabled={disabled}
        options={pastDescriptions}
        loading={isLoadingDescriptions}
      />
    </div>
  );
};

export default DescriptionCell;
