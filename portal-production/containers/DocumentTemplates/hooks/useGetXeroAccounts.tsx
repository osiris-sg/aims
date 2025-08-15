import { useEffect, useState } from "react";
import { request } from "../../../helpers/request";
import { useAuth } from "@clerk/nextjs";

interface XeroAccount {
  accountID: string;
  code: string;
  name: string;
  type: string;
  status: string;
  description?: string;
  displayName: string;
}

export default function useGetXeroAccounts() {
  const { getToken } = useAuth();
  const [accounts, setAccounts] = useState<XeroAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isXeroConnected, setIsXeroConnected] = useState(false);

  const fetchAccounts = async () => {
    if (loading) return;

    setLoading(true);
    setError(null);

    try {
      const token = await getToken();
      if (!token) {
        throw new Error("No authentication token available");
      }

      const response = await request(
        {
          path: `/xero/accounts`,
          method: "GET",
        },
        {},
        token
      );

      if (response?.success && response?.data?.data) {
        // The accounts are in response.data.data (double nested)
        const accountsArray = response.data.data;
        setAccounts(accountsArray);
        setIsXeroConnected(true);
      } else {
        setError("Failed to fetch Xero accounts");
        setIsXeroConnected(false);
      }
    } catch (err: any) {
      console.error("Error fetching Xero accounts:", err);
      setError(err.message || "Failed to fetch Xero accounts");
      setIsXeroConnected(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAccounts();
  }, []);

  return {
    accounts,
    loading,
    error,
    isXeroConnected,
    refetch: fetchAccounts,
  };
}
