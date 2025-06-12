import { useState, useEffect } from "react";
import { useOrganization, useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";

export const useGetCustomers = () => {
  const { organization } = useOrganization();
  const { getToken } = useAuth();
  const [customers, setCustomers] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCustomers = async () => {
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
          path: `/customers`,
          method: "POST",
        },
        {
          organizationId,
          page: 1,
          limit: 100,
          search: "",
          filters: {},
        },
        token
      );

      if (response.success) {
        setCustomers(response.data.docs || []);
      } else {
        setError(response.message || "Failed to fetch customers");
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "An error occurred while fetching customers";
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCustomers();
  }, [organization?.id]);

  return {
    customers,
    isLoading,
    error,
    refetch: fetchCustomers,
  };
};
