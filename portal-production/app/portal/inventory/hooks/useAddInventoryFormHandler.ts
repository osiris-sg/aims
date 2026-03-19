import { useForm } from "react-hook-form";
// import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import useGetAssets from "./useGetAssets";
import useGetCategories from "./useGetCategories";
import useGetSkuRange from "./useGetSkuRange";
import * as yup from "yup";
import { yupResolver } from "@hookform/resolvers/yup";
import { useNotifications } from "../../hooks/useNotifications";

interface AddInventoryFormData {
  assetId: string;
  sku: string;
  quantity: number;
  category: string;
  location: string;
  status: string;
}

interface UseAddInventoryFormHandlerProps {
  onSuccess?: () => void;
}

export default function useAddInventoryFormHandler({ onSuccess }: UseAddInventoryFormHandlerProps = {}) {
  const { organization } = useOrganization();
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const { showNotification } = useNotifications();
  const organizationId = organization?.id;
  const { assets } = useGetAssets();
  const { categories } = useGetCategories();

  const inventorySchema = yup.object().shape({
    assetId: yup.string().required("Asset is required"),
    category: yup.string().required("Category is required"),
    quantity: yup.number().typeError("Quantity must be a number").integer("Quantity must be a whole number").min(1, "Minimum quantity is 1").required("Quantity is required"),
    location: yup.string().required("Location is required"),
    status: yup.string().required("Status is required"),
    sku: yup.string().required("SKU is required"),
  });

  const { control, handleSubmit, watch, setValue, reset } = useForm<AddInventoryFormData>({
    defaultValues: {
      assetId: "",
      sku: "",
      quantity: 1,
      category: "",
      location: "Singapore",
      status: "",
    },
    resolver: yupResolver(inventorySchema),
  });

  // Watch assetId and quantity for SKU range
  const assetId = watch("assetId");
  const quantity = watch("quantity");
  const { skuRange, isLoading: isSkuLoading } = useGetSkuRange({
    assetId: assetId || "",
    quantity: quantity || 0,
  });

  // Update SKU when SKU range changes
  useEffect(() => {
    if (skuRange.length > 0) {
      setValue("sku", skuRange.join(","));
    }
  }, [skuRange, setValue]);

  // Watch assetId to update category
  useEffect(() => {
    if (assetId && assets?.docs) {
      const selectedAsset = assets.docs.find((asset: any) => asset.id === assetId);
      if (selectedAsset) {
        const category = categories.find((cat: any) => cat.id === selectedAsset.categoryId);
        setValue("category", category?.name || "");
      }
    }
  }, [assetId, assets?.docs, categories, setValue]);

  // Add inventory mutation
  const { mutate: addInventory, isPending: isInvetoryUpdating } = useMutation({
    mutationFn: async (data: AddInventoryFormData) => {
      const token = await getToken();
      if (!token || !organizationId) throw new Error("No token or organization ID");

      // If user edited the SKU (different from auto-generated), send as customSku
      const autoSku = skuRange.join(",");
      const userEditedSku = data.sku && data.sku !== autoSku ? data.sku : undefined;

      const response = await request(
        {
          path: "/inventories/create",
          method: "POST",
        },
        {
          ...data,
          organizationId,
          sku: skuRange,
          ...(userEditedSku ? { customSku: userEditedSku } : {}),
        },
        token
      );

      if (!response.success) {
        throw new Error(response.message || "Failed to create inventory");
      }

      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["inventories"] });
      showNotification({
        message: "Inventory created successfully",
        type: "success",
      });
      reset();
      onSuccess?.();
    },
    onError: (error: Error) => {
      showNotification({
        message: error.message || "Failed to create inventory",
        type: "error",
      });
    },
  });

  const onSubmit = (data: AddInventoryFormData) => {
    addInventory(data);
  };

  return {
    control,
    handleSubmit,
    onSubmit,
    assets,
    isSkuLoading,
    isInvetoryUpdating,
    skuRange,
    reset,
  };
}
