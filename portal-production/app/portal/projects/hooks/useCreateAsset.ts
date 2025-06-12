import { useState } from "react";
import { useRouter } from "next/navigation";
import { useOrganization, useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";
import { ROUTES } from "@/routes";

interface CreateAssetData {
  name: string;
  skuKey: string;
  categoryId: string;
  organizationId: string;
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
    const organizationId = organization?.id;
    if (!organizationId) {
      setError("Organization ID is required");
      return false;
    }

    setIsLoading(true);
    setError(null);

    try {
      const token = await getToken();
      if (!token) {
        setError("Authentication token is required");
        return false;
      }

      // Prepare the request body
      const requestBody: CreateAssetData = {
        name: data.name,
        skuKey: data.skuKey,
        categoryId: data.categoryId,
        organizationId,
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
