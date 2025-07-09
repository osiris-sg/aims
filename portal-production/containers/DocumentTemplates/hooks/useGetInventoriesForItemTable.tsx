/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useCallback, useState, useEffect } from "react";
import { useOrganization } from "@hooks/useOrganization";
import { useAuth } from "@clerk/nextjs";
import { useParams } from "next/navigation";
import { request } from "@/helpers/request";

export const useGetInventoriesForItemTable = () => {
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const organizationId = organization?.id;
  const { type } = useParams() as { type?: string };
  const [inventoriesForDocument, setInventoriesForDocument] = useState<any[]>([]);
  const fetchInventoriesByStatus = useCallback(
    async (status: string) => {
      if (!organizationId) return [];
      const token = await getToken();
      if (!token) return [];

      const response = await request(
        {
          path: "/inventories/by-status",
          method: "POST",
        },
        {
          status,
        },
        token
      );
      console.log("Fetched inventories by status:", status, response?.data);
      return response?.data || [];
    },
    [organizationId]
  );

  const fetchAllInventories = useCallback(async () => {
    const token = await getToken();
    if (!token || !organizationId) return [];

    const response = await request(
      {
        path: "/inventories",
        method: "POST",
      },
      {
        status: "all",
        page: 1,
        limit: 100,
      },
      token
    );

    return response?.data?.docs || [];
  }, [organizationId]);

  const fetchInventoriesByIds = useCallback(
    async (inventoryIds: string[]) => {
      if (!inventoryIds?.length || !organizationId) return [];
      const token = await getToken();
      if (!token) return [];

      const response = await request(
        {
          path: "/inventories/by-ids",
          method: "POST",
        },
        {
          inventoryIds,
        },
        token
      );

      return response?.data || [];
    },
    [organizationId]
  );

  const getInventories = useCallback(async () => {
    if (!organizationId || !type) return [];

    let inventories: any[] = [];

    if (type === "RDO") {
      inventories = await fetchInventoriesByStatus("rental");
    } else if (type === "DO") {
      inventories = await fetchInventoriesByStatus("instock");
    } else if (type === "TI") {
      inventories = await fetchAllInventories();
      console.log("Fetched all inventories for TI:", inventories);
    }

    setInventoriesForDocument(inventories);
    return inventories;
  }, [organizationId, type, fetchInventoriesByStatus, fetchAllInventories, fetchInventoriesByIds]);

  // Removed direct call to getInventories; now handled by useEffect.

  // Fetch inventories when dependencies change
  useEffect(() => {
    getInventories();
  }, [getInventories]);

  return { inventoriesForDocument };
};
