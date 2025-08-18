"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";

interface XeroConnectionStatus {
  connected: boolean;
  message: string;
  tenantId?: string;
  accessToken?: {
    expired: boolean;
    expiresAt: string;
    minutesLeft: number;
  };
  refreshToken?: {
    expiresAt: string;
    daysLeft: number;
    warningThreshold: boolean;
  };
}

export function useXeroConnection() {
  const { organization } = useOrganization();
  const { getToken } = useAuth();
  const [connectionStatus, setConnectionStatus] = useState<XeroConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const checkConnection = async () => {
    if (!organization?.id) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const token = await getToken();
      if (!token) {
        setError("Authentication token is required");
        setLoading(false);
        return;
      }

      const response = await request(
        {
          path: "/xero/status",
          method: "GET",
        },
        {},
        token
      );

      if (response && response.success && response.data) {
        setConnectionStatus(response.data);
      } else {
        setError("Failed to check Xero connection status");
      }
    } catch (error) {
      console.error("Error checking Xero connection:", error);
      setError("Failed to check Xero connection status");
      setConnectionStatus({ connected: false, message: "Connection check failed" });
    } finally {
      setLoading(false);
    }
  };

  const connectToXero = () => {
    if (organization?.id) {
      const connectUrl = `${process.env.NEXT_PUBLIC_BACKEND_API_URL || "http://localhost:4040"}/xero/connect?organizationId=${organization.id}`;
      window.location.href = connectUrl;
    }
  };

  useEffect(() => {
    checkConnection();
  }, [organization?.id]);

  return {
    connectionStatus,
    loading,
    error,
    connectToXero,
    refetch: checkConnection,
  };
}
