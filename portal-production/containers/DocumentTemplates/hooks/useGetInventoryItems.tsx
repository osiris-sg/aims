import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";

export const useGetInventoryItems = () => {
  const { getToken } = useAuth();
  const [inventoryItems, setInventoryItems] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const fetchInventoryItems = async () => {
      try {
        setIsLoading(true);
        const token = await getToken();
        if (!token) {
          setIsLoading(false);
          return;
        }

        // Fetch inventory items that are in stock
        const response = await request(
          {
            path: "/inventories",
            method: "GET",
          },
          {
            page: 1,
            limit: 1000, // Get all items
            filters: {
              status: "instock"
            }
          },
          token
        );

        if (response.success && response.data?.docs) {
          // Transform inventory items for easier display
          const items = response.data.docs.map((item: any) => ({
            id: item.id,
            sku: item.sku,
            name: item.assetName || item.description || item.sku,
            description: item.description || "",
            unitPrice: item.unitPrice || 0,
            quantity: item.quantity || 1,
            status: item.status,
            assetId: item.assetId,
            // Add any other fields you need
          }));
          setInventoryItems(items);
        }
      } catch (error) {
        console.error("Error fetching inventory items:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchInventoryItems();
  }, [getToken]);

  return { inventoryItems, isLoading };
};