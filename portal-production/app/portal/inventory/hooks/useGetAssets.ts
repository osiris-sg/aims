import { useQuery } from "@tanstack/react-query";
import { useOrganization, useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";

export default function useGetAssets() {
  const { organization } = useOrganization();
  const { getToken } = useAuth();
  const organizationId = organization?.id;

  const { data: assets = { docs: [] } } = useQuery({
    queryKey: ["assets", organizationId],
    queryFn: async () => {
      try {
        const token = await getToken();
        if (!token || !organizationId) return { docs: [] };

        const response = await request(
          {
            path: "/assets",
            method: "POST",
          },
          {
            page: 1,
            limit: 100,
            search: "",
            filters: {},
          },
          token
        );

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
