import { useState, useEffect } from "react";
import { useOrganization, useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";

export const useGetCategories = () => {
  const { organization } = useOrganization();
  const { getToken } = useAuth();
  const [categories, setCategories] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCategories = async () => {
    const organizationId = organization?.id;
    if (!organizationId) return;

    setIsLoading(true);
    setError(null);

    try {
      const token = await getToken();
      if (!token) {
        setError("Authentication token is required");
        return;
      }

      const response = await request(
        {
          path: `/categories`,
          method: "GET",
        },
        { organizationId },
        token
      );

      if (response.success) {
        setCategories(response.data);
      } else {
        setError(response.message || "Failed to fetch categories");
      }
    } catch (error) {
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
