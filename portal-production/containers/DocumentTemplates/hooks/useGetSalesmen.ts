import { useState, useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";

interface Salesman {
  id: string;
  salesmanCode: string;
  name: string;
  email?: string;
}

export function useGetSalesmen() {
  const { getToken } = useAuth();
  const [salesmen, setSalesmen] = useState<Salesman[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSalesmen = async () => {
      try {
        setLoading(true);
        const token = await getToken();
        if (!token) return;

        const response = await request(
          {
            path: "/organizations/salesmen/list",
            method: "GET",
          },
          {},
          token
        );

        if (response.success && response.data) {
          setSalesmen(response.data);
        }
      } catch (err: any) {
        console.error("Error fetching salesmen:", err);
        setError(err.message || "Failed to fetch salesmen");
      } finally {
        setLoading(false);
      }
    };

    fetchSalesmen();
  }, [getToken]);

  return { salesmen, loading, error };
}
