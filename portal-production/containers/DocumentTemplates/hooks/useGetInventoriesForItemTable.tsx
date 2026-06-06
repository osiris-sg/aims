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

    // Page through ALL assets. The CU/FCU/Accessory pickers filter this list
    // client-side by category, so a single capped page (was limit:100) makes
    // whole categories disappear once an org's catalogue exceeds the page size
    // (e.g. Cappitech now has 600+ assets, and /assets orders by createdAt desc,
    // so the older "Condensing Unit" items fell off the first page). Loop until
    // the server reports no more pages.
    const PAGE_SIZE = 200;
    let page = 1;
    let allAssets: any[] = [];
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const response = await request(
        { path: "/assets", method: "POST" },
        { page, limit: PAGE_SIZE },
        token
      );
      const docs = response?.data?.docs || [];
      allAssets = allAssets.concat(docs);
      const hasNext = response?.data?.hasNextPage ?? docs.length === PAGE_SIZE;
      if (!hasNext || docs.length === 0 || page > 100) break;
      page += 1;
    }

    // Map assets to the inventory item format expected by StockCardDialog
    return allAssets.map((asset: any) => ({
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
      // Nominal cooling capacity (kW) — shown as a Capacity column in the picker
      // for VRV / chiller / chilled-water FCU products that carry a rating.
      capacityKw: asset.capacityKw ?? null,
      // Hierarchy + category needed by the FCU-CU (QF) quotation dropdowns:
      // categoryId/categoryName split CU vs FCU lists; parentAssetId lets us
      // restrict the FCU dropdown to a CU's children (single-split pairs).
      parentAssetId: asset.parentAssetId ?? null,
      categoryId: asset.categoryId ?? asset.category?.id ?? null,
      customPrices: asset.customPrices,
      // Accessories tagged to this FCU: accessoryIds = auto-added defaults (panel +
      // wired remote); accessoryOptionIds = swappable options (black panel, wireless).
      accessoryIds: asset.accessoryIds ?? [],
      accessoryOptionIds: asset.accessoryOptionIds ?? [],
      asset: {
        id: asset.id,
        name: asset.name,
        description: asset.description,
        category: asset.category,
        categoryId: asset.categoryId ?? asset.category?.id ?? null,
        parentAssetId: asset.parentAssetId ?? null,
        uom: asset.uom || "PCS",
        price: asset.price,
        costPrice: asset.costPrice,
        customPrices: asset.customPrices,
        points: asset.points,
        capacityKw: asset.capacityKw ?? null,
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
