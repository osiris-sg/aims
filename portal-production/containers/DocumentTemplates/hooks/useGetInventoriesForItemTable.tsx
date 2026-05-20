/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useCallback, useState, useEffect } from "react";
import { useOrganization } from "@hooks/useOrganization";
import { useAuth } from "@clerk/nextjs";
import { useParams } from "next/navigation";
import { request } from "@/helpers/request";
import useGetDocument from "./useGetDocument";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";

export const useGetInventoriesForItemTable = () => {
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const organizationId = organization?.id;
  const { type } = useParams() as { type?: string };
  const { document } = useGetDocument();
  const [inventoriesForDocument, setInventoriesForDocument] = useState<any[]>([]);
  const { isAssetTrackingModeEnabled } = useOrganizationFeatures();
  console.log("🔍 useGetInventoriesForItemTable - orgId:", organizationId, "type:", type, "isAssetTrackingModeEnabled:", isAssetTrackingModeEnabled);
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

  // Fetch assets/products for Products mode (when tracking is OFF)
  const fetchAssets = useCallback(async () => {
    const token = await getToken();
    if (!token || !organizationId) return [];

    const response = await request(
      {
        path: "/assets",
        method: "POST",
      },
      {
        page: 1,
        limit: 100,
      },
      token
    );

    // Map assets to the inventory item format expected by StockCardDialog
    const assets = response?.data?.docs || [];
    return assets.map((asset: any) => ({
      id: asset.id,
      sku: asset.skuKey,
      name: asset.name,
      description: asset.description || asset.name,
      category: asset.category?.name || "",
      categoryName: asset.category?.name || "",
      quantity: asset.quantity ?? asset.stockCount ?? 0,
      minQuantity: asset.minQuantity,
      unitPrice: asset.price,
      // Surface costPrice both at the top level (for StockCardDialog display)
      // and inside the asset sub-object (for the picker's per-doc-type pricing).
      costPrice: asset.costPrice,
      uom: asset.uom || "PCS",
      status: asset.quantity > 0 ? "available" : "out_of_stock",
      assetId: asset.id,
      asset: {
        id: asset.id,
        name: asset.name,
        description: asset.description,
        category: asset.category,
        uom: asset.uom || "PCS",
        price: asset.price,
        costPrice: asset.costPrice,
        customPrices: asset.customPrices,
        points: asset.points,
      },
    }));
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

    // In Products mode (tracking OFF), fetch assets/products only
    console.log("useGetInventoriesForItemTable - isAssetTrackingModeEnabled:", isAssetTrackingModeEnabled);
    if (!isAssetTrackingModeEnabled) {
      inventories = await fetchAssets();
      setInventoriesForDocument(inventories);
      return inventories;
    }

    // In Assets mode (tracking ON), fetch BOTH:
    // 1. Untracked assets (products without inventory items)
    // 2. Tracked inventory items
    const untrackedAssets = (await fetchAssets()).filter((a: any) => a.quantity !== undefined);

    let trackedInventories: any[] = [];
    if (type === "RDO") {
      trackedInventories = await fetchInventoriesByStatus("rental");
    } else if (type === "DO") {
      trackedInventories = await fetchInventoriesByStatus("instock");
    } else {
      trackedInventories = await fetchAllInventories();
    }

    // Merge: exclude untracked assets that already have tracked inventory items
    const trackedAssetIds = new Set(trackedInventories.map((inv: any) => inv.assetId));
    const uniqueUntrackedAssets = untrackedAssets.filter((a: any) => !trackedAssetIds.has(a.assetId));
    inventories = [...uniqueUntrackedAssets, ...trackedInventories];

    // Also fetch inventory items that are used in the current document
    // This ensures that items show up in dropdown even if their status has changed
    if (document?.config?.items && Array.isArray(document.config.items)) {
      const documentInventoryIds = document.config.items.map((item: any) => item.inventoryItemId).filter((id: string) => id && id.trim() !== "");

      if (documentInventoryIds.length > 0) {
        const documentInventories = await fetchInventoriesByIds(documentInventoryIds);

        // Merge document inventories with status-based inventories (avoid duplicates)
        const existingIds = inventories.map((inv) => inv.id);
        const uniqueDocumentInventories = documentInventories.filter((inv: any) => !existingIds.includes(inv.id));
        inventories = [...inventories, ...uniqueDocumentInventories];
      }
    }

    setInventoriesForDocument(inventories);
    return inventories;
  }, [organizationId, type, document?.config?.items, fetchInventoriesByStatus, fetchAllInventories, fetchInventoriesByIds, isAssetTrackingModeEnabled, fetchAssets]);

  // Removed direct call to getInventories; now handled by useEffect.

  // Fetch inventories when dependencies change
  useEffect(() => {
    getInventories();
  }, [getInventories]);

  return { inventoriesForDocument };
};
