/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect } from "react";
import FormInputBox from "@/form-components/FormInputBox";
import { Control, useWatch, UseFormSetValue } from "react-hook-form";
import { useGetAssets } from "./useGetAssets";

interface PriceCellProps {
  rowIndex: number;
  control: Control<any>;
  setValue: UseFormSetValue<any>;
  viewMode: boolean;
  rentedInventories: any[];
  disabled?: boolean;
}

const PriceCell: React.FC<PriceCellProps> = ({ rowIndex, control, setValue, viewMode, rentedInventories, disabled }) => {
  const { assets } = useGetAssets();
  const inventoryItemId = useWatch({ control, name: `items.${rowIndex}.inventoryItemId` });

  useEffect(() => {
    const selectedInventory = rentedInventories.find((inv) => inv.id === inventoryItemId);
    const relatedAsset = assets?.docs?.find((asset: { id: any }) => asset.id === selectedInventory?.assetId);

    if (relatedAsset?.price) {
      setValue(`items.${rowIndex}.price`, relatedAsset.price);
    }
  }, [inventoryItemId, rentedInventories, assets, rowIndex, setValue]);

  return <FormInputBox control={control} name={`items.${rowIndex}.price`} placeHolder="Enter Price" size="small" labelArriangment={viewMode ? "horizontal" : "vertical"} viewMode={viewMode} disabled={disabled} />;
};

export default PriceCell;
