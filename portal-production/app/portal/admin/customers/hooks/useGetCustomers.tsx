import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";

interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  createdAt: string;
  updatedAt: string;
  organization: {
    id: string;
    name: string;
  };
}

export function useGetCustomers() {
  const { getToken } = useAuth();

  const [customers, setCustomers] = useState<{
    docs: Customer[];
    totalDocuments: number;
    totalPagesCount: number;
  }>({
    docs: [],
    totalDocuments: 0,
    totalPagesCount: 0,
  });

  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({
    organization: "",
  });

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) {
        console.error("No authentication token available");
        return;
      }

      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}/admin/customers`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch customers");
      }

      const data = await response.json();
      console.log("Get admin customers data", data);

      let customersArray: Customer[] = [];

      if (Array.isArray(data)) {
        customersArray = data;
      } else if (data && data.success && Array.isArray(data.data)) {
        customersArray = data.data;
      } else {
        console.error("Unexpected response format:", data);
        throw new Error(`Invalid response format from admin customers endpoint. Got: ${JSON.stringify(data)}`);
      }

      // Apply client-side filtering
      let filteredCustomers = customersArray;

      // Apply search filter
      if (search) {
        filteredCustomers = filteredCustomers.filter(
          (customer: any) => customer.name.toLowerCase().includes(search.toLowerCase()) || customer.email.toLowerCase().includes(search.toLowerCase()) || customer.phone.toLowerCase().includes(search.toLowerCase()) || customer.organization?.name.toLowerCase().includes(search.toLowerCase())
        );
      }

      // Apply organization filter
      if (filters.organization) {
        filteredCustomers = filteredCustomers.filter((customer: any) => customer.organization?.name.toLowerCase().includes(filters.organization.toLowerCase()));
      }

      // Apply pagination
      const totalDocuments = filteredCustomers.length;
      const totalPagesCount = Math.ceil(totalDocuments / limit);
      const startIndex = (page - 1) * limit;
      const endIndex = startIndex + limit;
      const paginatedCustomers = filteredCustomers.slice(startIndex, endIndex);

      setCustomers({
        docs: paginatedCustomers,
        totalDocuments,
        totalPagesCount,
      });
    } catch (error) {
      console.error("Error fetching admin customers:", error);
    } finally {
      setLoading(false);
    }
  }, [page, limit, search, filters, getToken]);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  const refreshCustomers = () => {
    fetchCustomers();
  };

  return {
    customers,
    loading,
    page,
    limit,
    search,
    filters,
    setPage,
    setLimit,
    setSearch,
    setFilters,
    refreshCustomers,
  };
}
