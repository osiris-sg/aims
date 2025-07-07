/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useForm } from "react-hook-form";
import { useDispatch, useSelector } from "react-redux";
import { inventoryActions } from "@/containers/Inventory/slice";
import { useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { selectAssets, selectCategories, selectIsInventoryUpdating, selectIsSkuloading, selectSkuRange } from "../slice/selectors";
import { INVENTORY_STATUS } from "../slice/constants";
import * as yup from "yup";
import { yupResolver } from "@hookform/resolvers/yup";

export default function useAddInventoryFormHandler() {
  const dispatch = useDispatch();
  const skuRange = useSelector(selectSkuRange);
  const isSkuLoading = useSelector(selectIsSkuloading);
  const isInvetoryUpdating = useSelector(selectIsInventoryUpdating);
  const categories = useSelector(selectCategories);
  const assets = useSelector(selectAssets);
  const { getToken } = useAuth();
  const { organization } = useOrganization();

  const inventorySchema = yup.object().shape({
    assetId: yup.string().required("Asset is required"),
    category: yup.string().required("Category is required"),
    quantity: yup.number().typeError("Quantity must be a number").integer("Quantity must be a whole number").min(1, "Minimum quantity is 1").required("Quantity is required"),
    location: yup.string().required("Location is required"),
    status: yup.string().required("Status is required"),
    sku: yup.string().required("SKU is required"),
  });

  const { control, handleSubmit, setValue, watch } = useForm({
    defaultValues: {
      assetId: "",
      category: "",
      quantity: 1,
      location: "",
      status: INVENTORY_STATUS[INVENTORY_STATUS.length - 1].value,
      sku: "",
    },
    resolver: yupResolver(inventorySchema),
  });

  const selectedAsset = watch("assetId");
  const quantity = watch("quantity");

  useEffect(() => {
    if (selectedAsset) {
      const asset = assets.docs.find((asset) => asset.id === selectedAsset);
      const category = categories.find((item) => item.id === asset?.categoryId);
      if (asset) {
        setValue("category", `${category?.name}`);
      }
    }
  }, [selectedAsset]);

  useEffect(() => {
    setValue("sku", skuRange?.join(","));
  }, [skuRange]);

  // Fetch SKU range when asset or quantity changes
  useEffect(() => {
    if (selectedAsset && quantity > 0) {
      const fetchSkuRange = async () => {
        try {
          const token = await getToken();
          dispatch(inventoryActions.generateSkuRange({ assetId: selectedAsset, quantity: parseInt(`${quantity}`), token, organizationId: organization?.id }));
        } catch (error) {
          console.error("Error fetching SKU range:", error);
        }
      };

      fetchSkuRange();
    }
  }, [selectedAsset, quantity, getToken, setValue]);

  const onSubmit = async (data: any) => {
    try {
      const token = await getToken();
      dispatch(
        inventoryActions.createInventory({
          ...data,
          organizationId: organization?.id || "",
          quantity: Number(data.quantity),
          token,
          sku: skuRange,
        })
      );
    } catch (error) {
      console.error("Error submitting form:", error);
    }
  };

  return {
    control,
    handleSubmit,
    onSubmit,
    skuRange,
    assets,
    isSkuLoading,
    isInvetoryUpdating,
  };
}
