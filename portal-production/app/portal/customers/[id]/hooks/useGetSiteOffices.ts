import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { request } from "@/helpers/request";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";

export const useGetSiteOffices = () => {
  const { id: customerId } = useParams<{ id: string }>();
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const organizationId = organization?.id;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["site-offices", customerId],
    enabled: !!customerId && !!organizationId,
    queryFn: async () => {
      const token = await getToken();
      if (!token || !organizationId) throw new Error("Missing token or organization ID");

      const response = await request(
        {
          path: `/customers/${customerId}/site-offices`,
          method: "GET",
        },
        {},
        token
      );

      if (!response.success) throw new Error(response.message || "Failed to fetch site offices");
      return response.data;
    },
  });

  return { siteOffices: data, isLoading, error, refetch };
};
