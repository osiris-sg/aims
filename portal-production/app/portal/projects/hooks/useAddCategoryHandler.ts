import { useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@clerk/nextjs";
import { request } from "@/helpers/request";
import { useGetCustomers } from "./useGetCustomers";

export const useAddCustomerHandler = () => {
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const organizationId = organization?.id;
  const { customers, refetch: refetchCustomers } = useGetCustomers();
  const [customersLoading, setCustomersLoading] = useState(false);
  const [deleteCustomerLoading, setDeleteCustomerLoading] = useState(false);

  const handleAddCustomer = async (customerName: string) => {
    try {
      if (!organizationId) return false;

      setCustomersLoading(true);
      const token = await getToken();
      if (!token) return false;

      const response = await request(
        {
          path: "/customers/create",
          method: "POST",
        },
        {
          name: customerName,
        },
        token
      );

      if (response.success) {
        await refetchCustomers();
        return true;
      }
      return false;
    } catch (error) {
      console.error("Error creating customer:", error);
      return false;
    } finally {
      setCustomersLoading(false);
    }
  };

  const handleDeleteCustomer = async (id: string) => {
    try {
      if (!organizationId) return false;

      setDeleteCustomerLoading(true);
      const token = await getToken();
      if (!token) return false;

      const response = await request(
        {
          path: `/customers/${id}`,
          method: "DELETE",
        },
        {},
        token
      );

      if (response.success) {
        await refetchCustomers();
        return true;
      }
      return false;
    } catch (error) {
      console.error("Error deleting customer:", error);
      return false;
    } finally {
      setDeleteCustomerLoading(false);
    }
  };

  return {
    handleAddCustomer,
    handleDeleteCustomer,
    customers: customers || [],
    customersLoading,
    deleteCustomerLoading,
  };
};
