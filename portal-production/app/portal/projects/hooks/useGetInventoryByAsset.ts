import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";

export default function useGetInventoryByAsset(assetId: string) {
  const { getToken } = useAuth();

  const {
    data: inventoryData = { inventories: [], statusCounts: {} },
    isLoading,
    error,
  } = useQuery({
    queryKey: ["inventoryByAsset", assetId],
    queryFn: async () => {
      const token = await getToken();
      if (!token || !assetId) return { inventories: [], statusCounts: {} };

      const response = await request(
        {
          path: `/inventories/asset/${assetId}`,
          method: "GET",
        },
        undefined,
        token
      );

      if (!response.success) {
        console.error("Failed to fetch inventory by asset:", response.message);
        return { inventories: [], statusCounts: {} };
      }

      return response.data;
    },
    enabled: !!assetId,
  });

  return { inventoryData, isLoading, error };
}
