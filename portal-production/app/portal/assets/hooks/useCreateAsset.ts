import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import { ROUTES } from "@/routes";

interface CreateAssetData {
  name: string;
  skuKey: string;
  categoryId: string;
  uom?: string;
  image?: File;
  description?: string;
  price?: number;
  isTracked?: boolean;
  quantity?: number;
  minQuantity?: number;
}

export const useCreateAsset = () => {
  const router = useRouter();
  const { organization } = useOrganization();
  const { getToken } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createAsset = async (data: CreateAssetData) => {
    setIsLoading(true);
    setError(null);

    try {
      const token = await getToken();
      if (!token) {
        setError("Authentication token is required");
        return false;
      }

      // Prepare the request body
      const requestBody: any = {
        name: data.name,
        skuKey: data.skuKey,
        categoryId: data.categoryId,
        description: data.description || "",
        uom: data.uom || "PCS",
        isTracked: data.isTracked ?? true,
      };

      // Add price if provided
      if (data.price !== undefined && data.price !== null && !isNaN(Number(data.price))) {
        requestBody.price = Number(data.price);
      }

      // Add quantity for untracked products (ensure it's a number)
      if (data.isTracked === false && data.quantity !== undefined) {
        requestBody.quantity = Number(data.quantity);
      }

      // Add minimum quantity if provided
      if (data.minQuantity !== undefined && data.minQuantity !== null && !isNaN(Number(data.minQuantity))) {
        requestBody.minQuantity = Number(data.minQuantity);
      }

      console.log("Request Body:", requestBody);

      const response = await request(
        {
          path: "/assets/create",
          method: "POST",
        },
        requestBody,
        token
      );

      if (response.success) {
        return true;
      } else {
        setError(response.message || "Failed to create asset");
        return false;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "An error occurred while creating the asset";
      setError(errorMessage);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  return {
    createAsset,
    isLoading,
    error,
  };
};
