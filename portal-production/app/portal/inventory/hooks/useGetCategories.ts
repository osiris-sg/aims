import { useQuery } from "@tanstack/react-query";
import { useOrganization, useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";

interface Category {
  id: string;
  name: string;
}

export default function useGetCategories() {
  const { organization } = useOrganization();
  const { getToken } = useAuth();
  const organizationId = organization?.id;

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ["categories", organizationId],
    queryFn: async () => {
      try {
        const token = await getToken();
        if (!token || !organizationId) return [];

        const response = await request(
          {
            path: "/categories",
            method: "GET",
          },
          {},
          token
        );

        if (!response.success) {
          console.error("Failed to fetch categories:", response.message);
          return [];
        }

        return response.data;
      } catch (error) {
        console.error("Error fetching categories:", error);
        return [];
      }
    },
    enabled: !!organizationId,
  });

  return { categories };
}
