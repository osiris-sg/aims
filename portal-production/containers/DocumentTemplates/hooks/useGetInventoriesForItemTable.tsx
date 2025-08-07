/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useCallback, useState, useEffect } from "react";
import { useOrganization } from "@hooks/useOrganization";
import { useAuth } from "@clerk/nextjs";
import { useParams } from "next/navigation";
import { request } from "@/helpers/request";
import useGetDocument from "./useGetDocument";

export const useGetInventoriesForItemTable = () => {
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const organizationId = organization?.id;
  const { type } = useParams() as { type?: string };
  const { document } = useGetDocument();
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
  }, [organizationId, getToken]);

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
    [organizationId, getToken]
  );

  const getInventories = useCallback(async () => {
    if (!organizationId || !type) return [];

    let inventories: any[] = [];

    if (type === "RDO") {
      inventories = await fetchInventoriesByStatus("rental");
    } else if (type === "DO") {
      inventories = await fetchInventoriesByStatus("instock");
    } else {
      inventories = await fetchAllInventories();
    }

    // Also fetch inventory items that are used in the current document
    // This ensures that items show up in dropdown even if their status has changed
    if (document?.config?.items && Array.isArray(document.config.items)) {
      const documentInventoryIds = document.config.items.map((item: any) => item.inventoryItemId).filter((id: string) => id && id.trim() !== "");

      if (documentInventoryIds.length > 0) {
        const documentInventories = await fetchInventoriesByIds(documentInventoryIds);

        // Merge document inventories with status-based inventories (avoid duplicates)
        const existingIds = inventories.map((inv) => inv.id);
        const uniqueDocumentInventories = documentInventories.filter((inv) => !existingIds.includes(inv.id));
        inventories = [...inventories, ...uniqueDocumentInventories];
      }
    }

    setInventoriesForDocument(inventories);
    return inventories;
  }, [organizationId, type, document?.config?.items, fetchInventoriesByStatus, fetchAllInventories, fetchInventoriesByIds]);

  // Removed direct call to getInventories; now handled by useEffect.

  // Fetch inventories when dependencies change
  useEffect(() => {
    getInventories();
  }, [getInventories]);

  return { inventoriesForDocument };
};
