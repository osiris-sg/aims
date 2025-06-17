import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";
import { useOrganization } from "@clerk/nextjs";
export default function useGetInventoryByAsset(assetId: string) {
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const organizationId = organization?.id;
  const {
    data: inventoryData = { inventories: [], statusCounts: {} },
    isLoading,
    error,
  } = useQuery({
    queryKey: ["inventoryByAsset", assetId],
    queryFn: async () => {
      const token = await getToken();
      if (!token || !assetId) return { inventories: [], statusCounts: {} };

      const assetInventoryResponse = await request(
        {
          path: `/inventories/asset/${assetId}`,
          method: "GET",
        },
        undefined,
        token
      );

      if (!assetInventoryResponse.success) {
        console.error("Failed to fetch inventory by asset:", assetInventoryResponse.message);
        return { inventories: [], statusCounts: {} };
      }

      const filteredInventories = assetInventoryResponse.data.inventories?.filter((inv) => inv.status?.toLowerCase() === "instock") || [];

      return {
        inventories: filteredInventories,
        statusCounts: assetInventoryResponse.data.statusCounts,
      };
    },
    enabled: !!assetId,
  });

  return { inventoryData, isLoading, error };
}
