import { useState, useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "../../hooks/useOrganization";
import { request } from "@/helpers/request";

export const useGetCategories = () => {
  const { organization } = useOrganization();
  const { getToken } = useAuth();
  const [categories, setCategories] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCategories = async () => {
    const organizationId = organization?.id;
    console.log("Fetching categories for organization:", organizationId);

    if (!organizationId) {
      console.error("No organization ID available for fetching categories");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const token = await getToken();
      if (!token) {
        console.error("No authentication token available for categories");
        setError("Authentication token is required");
        return;
      }

      console.log("Making GET request to /categories");
      const response = await request(
        {
          path: `/categories`,
          method: "GET",
        },
        {},
        token
      );

      console.log("Categories response:", response);

      if (response.success) {
        console.log("Categories loaded successfully:", response.data);
        setCategories(response.data);
      } else {
        console.error("Failed to fetch categories:", response);
        setError(response.message || "Failed to fetch categories");
      }
    } catch (error) {
      console.error("Error fetching categories:", error);
      const errorMessage = error instanceof Error ? error.message : "An error occurred while fetching categories";
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCategories();
  }, [organization?.id]);

  return {
    categories,
    isLoading,
    error,
    refetch: fetchCategories,
  };
};
