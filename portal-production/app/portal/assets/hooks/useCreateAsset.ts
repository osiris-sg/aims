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
  image?: File;
  description?: string;
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
      const requestBody = {
        name: data.name,
        skuKey: data.skuKey,
        categoryId: data.categoryId,
        description: data.description || "",
      };

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
