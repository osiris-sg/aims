import { useState, useCallback } from "react";
import { useOrganization } from "@hooks/useOrganization";
import { useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";

export const useGetSiteOffices = () => {
  const { organization } = useOrganization();
  const { getToken } = useAuth();
  const organizationId = organization?.id;

  const [siteOffices, setSiteOffices] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchSiteOffices = useCallback(
    async (customerId: string) => {
      if (!organizationId || !customerId) return;
      setLoading(true);

      try {
        const token = await getToken();
        if (!token) return false;

        const siteOfficeRes = await request({ path: `/customers/${customerId}/site-offices`, method: "GET" }, {}, token);

        if (siteOfficeRes.success) {
          setSiteOffices(siteOfficeRes.data || []);
        } else {
          setSiteOffices([]);
        }
      } catch (err) {
        console.error("Failed to fetch site offices:", err);
      } finally {
        setLoading(false);
      }
    },
    [organizationId, getToken]
  );

  return { siteOffices, loading, fetchSiteOffices };
};
