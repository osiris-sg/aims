import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useOrganization, useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";
import { API } from "../constants";

interface QRCodeResponse {
  qrCode: string;
}

export default function useViewQRHandler() {
  const { organization } = useOrganization();
  const { getToken } = useAuth();
  const organizationId = organization?.id;
  const [selectedSku, setSelectedSku] = useState<string | null>(null);

  const { data: qrCode, isLoading: isQrLoading } = useQuery<QRCodeResponse>({
    queryKey: ["qrCode", selectedSku, organizationId],
    queryFn: async () => {
      if (!selectedSku || !organizationId) return { qrCode: "" };

      const token = await getToken();
      if (!token) throw new Error("No token available");

      const response = await request(
        {
          path: API.GET_QR_CODE.path.replace(":sku", selectedSku),
          method: API.GET_QR_CODE.method,
        },
        {
          organizationId,
        },
        token
      );

      if (!response.success) {
        throw new Error(response.message || "Failed to fetch QR code");
      }

      return response.data;
    },
    enabled: !!selectedSku && !!organizationId,
  });

  const openQRDialog = (sku: string) => {
    setSelectedSku(sku);
  };

  const closeQRDialog = () => {
    setSelectedSku(null);
  };

  return {
    qrCode: qrCode?.qrCode || "",
    isQrLoading,
    openQRDialog,
    closeQRDialog,
    selectedSku,
  };
}
 