/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useState, useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";

interface DeliveryOrder {
  id: string;
  name: string;
  doNo: string;
  status: string;
  customerId: string;
  customerName: string;
  createdAt: string;
}

export const useGetDeliveryOrders = (customerId?: string) => {
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const [deliveryOrders, setDeliveryOrders] = useState<DeliveryOrder[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDeliveryOrders = async (customerIdFilter: string) => {
    if (!organization?.id || !customerIdFilter) {
      setDeliveryOrders([]);
      return;
    }

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
          path: `/documents/delivery-orders/${customerIdFilter}`,
          method: "GET",
        },
        {},
        token
      );

      if (response.success) {
        setDeliveryOrders(response.data || []);
      } else {
        setError(response.message || "Failed to fetch delivery orders");
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "An error occurred while fetching delivery orders";
      setError(errorMessage);
      console.error("Error fetching delivery orders:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (customerId) {
      fetchDeliveryOrders(customerId);
    } else {
      setDeliveryOrders([]);
    }
  }, [customerId, organization?.id]);

  return {
    deliveryOrders,
    isLoading,
    error,
    refetch: () => customerId && fetchDeliveryOrders(customerId),
  };
};
