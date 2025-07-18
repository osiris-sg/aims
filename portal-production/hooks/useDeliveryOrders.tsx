"use client";
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import moment from "moment";

interface DeliveryOrder {
  id: string;
  name: string;
  customerName: string;
  completedDate: string;
}

interface DeliveryOrdersData {
  totalPending: number;
  pendingOrders: DeliveryOrder[];
}

const API = {
  GET_DELIVERY_ORDERS_PENDING: {
    path: "/dashboard/delivery-orders-pending",
    method: "GET",
  },
};

export default function useDeliveryOrders() {
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const organizationId = organization?.id;

  const [deliveryOrdersData, setDeliveryOrdersData] = useState<DeliveryOrdersData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDeliveryOrders = useCallback(async () => {
    if (!organizationId) return;

    setLoading(true);
    setError(null);

    try {
      const token = await getToken();
      if (!token) return;

      // Fetch delivery orders pending data
      const response = await request(API.GET_DELIVERY_ORDERS_PENDING, {}, token);

      if (response.success && response.data) {
        setDeliveryOrdersData(response.data);
      } else {
        setError(response.message || "Failed to fetch delivery orders data");
      }
    } catch (err) {
      console.error("Error fetching delivery orders:", err);
      setError("An error occurred while fetching delivery orders data");
    } finally {
      setLoading(false);
    }
  }, [organizationId, getToken]);

  useEffect(() => {
    fetchDeliveryOrders();
  }, [fetchDeliveryOrders]);

  return {
    deliveryOrdersData,
    loading,
    error,
    refetch: fetchDeliveryOrders,
  };
}
