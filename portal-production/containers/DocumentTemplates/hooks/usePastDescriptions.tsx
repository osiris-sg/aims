import { useState, useEffect } from "react";
import { request } from "@/helpers/request";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";

export function usePastDescriptions() {
  const [pastDescriptions, setPastDescriptions] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const { getToken } = useAuth();
  const { organization, isLoaded } = useOrganization();

  useEffect(() => {
    const fetchPastDescriptions = async () => {
      if (!isLoaded) return;
      if (!organization?.id) return;

      try {
        setIsLoading(true);
        const token = await getToken();
        if (!token) return;

        const response = await request(
          { path: "/documents/past-descriptions", method: "GET" },
          {},
          token
        );

        if (response.success && response.data?.descriptions) {
          setPastDescriptions(response.data.descriptions);
        }
      } catch (error) {
        console.error("Error fetching past descriptions:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchPastDescriptions();
  }, [organization?.id, getToken, isLoaded]);

  return { pastDescriptions, isLoading };
}
