import { useQuery } from "@tanstack/react-query";
// import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";

export default function useGetAssets() {
  const { organization } = useOrganization();
  const { getToken } = useAuth();
  const organizationId = organization?.id;

  const { data: assets = { docs: [] } } = useQuery({
    queryKey: ["assets", "tracked", organizationId],
    queryFn: async () => {
      try {
        console.log("=== useGetAssets fetching ===");
        console.log("organizationId:", organizationId);

        const token = await getToken();
        if (!token || !organizationId) {
          console.log("Missing token or organizationId");
          return { docs: [] };
        }

        const response = await request(
          {
            path: "/assets",
            method: "POST",
          },
          {
            page: 1,
            limit: 100,
            search: "",
            filters: {
              // Only show tracked assets for inventory creation
              // Untracked products cannot have individual inventory items
              isTracked: true,
            },
            organizationId,
          },
          token
        );

        console.log("Assets response:", response);
        console.log("Assets response.data:", response.data);

        if (!response.success) {
          console.error("Failed to fetch assets:", response.message);
          return { docs: [] };
        }

        return response.data;
      } catch (error) {
        console.error("Error fetching assets:", error);
        return { docs: [] };
      }
    },
    enabled: !!organizationId,
  });

  return { assets };
}
