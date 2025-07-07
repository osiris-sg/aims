import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";

interface SkuRangeParams {
  assetId: string;
  quantity: number;
}

export default function useGetSkuRange(params: SkuRangeParams) {
  const { organization } = useOrganization();
  const { getToken } = useAuth();
  const organizationId = organization?.id;

  const { data: skuRange = [], isLoading } = useQuery({
    queryKey: ["skuRange", params.assetId, params.quantity, organizationId],
    queryFn: async () => {
      try {
        const token = await getToken();
        if (!token || !organizationId) return [];

        const response = await request(
          {
            path: "/inventories/generate-sku",
            method: "POST",
          },
          {
            assetId: params.assetId,
            quantity: Number(params.quantity),
            organizationId,
          },
          token
        );

        if (!response.success) {
          console.error("Failed to fetch SKU range:", response.message);
          return [];
        }

        return response.data;
      } catch (error) {
        console.error("Error fetching SKU range:", error);
        return [];
      }
    },
    enabled: !!params.assetId && params.quantity > 0 && !!organizationId,
  });

  return { skuRange, isLoading };
}
