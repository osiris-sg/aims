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

// Catalogue loading for the document editor's item picker.
//
// Small catalogues (≤ PRELOAD_MAX products) are loaded in full — pages fetched
// in PARALLEL — so the Stock Card, the FCU/CU pickers and the Item dropdowns
// behave exactly as before. Large catalogues are NOT paged through any more:
// the old loop walked 200 at a time, one request after another, and for Chong
// Aik (87k products) took 35s per editor open and still stopped at the
// 100-page cap, leaving the picker both slow and incomplete (guru 2026-10-23).
// Instead the editor gets the first page plus every product its lines
// reference, and the Stock Card searches the server (`searchCatalogue`).
const PAGE_SIZE = 200;
const PRELOAD_MAX = 1000;
const SEARCH_LIMIT = 50;

// Map an Asset row to the inventory item shape the pickers expect.
export const mapAssetToPickerItem = (asset: any) => ({
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
  // GL revenue accounts — drive the Stock Card Rental/Sales tabs + line self-coding.
  salesAccountCode: asset.salesAccountCode ?? null,
  rentalAccountCode: asset.rentalAccountCode ?? null,
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
    salesAccountCode: asset.salesAccountCode ?? null,
    rentalAccountCode: asset.rentalAccountCode ?? null,
  },
});

const mergeById = (base: any[], extra: any[]) => {
  if (!extra?.length) return base;
  const seen = new Set(base.map((i) => i.id));
  const add = extra.filter((i) => i && !seen.has(i.id));
  return add.length ? [...base, ...add] : base;
};

const chunk = <T,>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

export const useGetInventoriesForItemTable = () => {
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const organizationId = organization?.id;
  const { type } = useParams() as { type?: string };
  const { document } = useGetDocument();
  const [inventoriesForDocument, setInventoriesForDocument] = useState<any[]>([]);
  // false once the org's catalogue is bigger than PRELOAD_MAX — the picker then
  // searches the server instead of filtering the (partial) preload.
  const [catalogueComplete, setCatalogueComplete] = useState(true);
  const [catalogueTotal, setCatalogueTotal] = useState(0);
  const { isAssetTrackingModeEnabled } = useOrganizationFeatures();

  const post = useCallback(
    async (path: string, body: any) => {
      const token = await getToken();
      if (!token) return null;
      return request({ path, method: "POST" }, body, token);
    },
    [getToken]
  );

  const fetchInventoriesByStatus = useCallback(
    async (status: string) => {
      if (!organizationId) return [];
      const response = await post("/inventories/by-status", { status });
      return response?.data || [];
    },
    [organizationId, post]
  );

  // Every tracked unit, pages fetched in parallel, capped at PRELOAD_MAX.
  const fetchAllInventories = useCallback(async (): Promise<{ items: any[]; complete: boolean; total: number }> => {
    if (!organizationId) return { items: [], complete: true, total: 0 };
    const first = await post("/inventories", { status: "all", page: 1, limit: PAGE_SIZE });
    const docs: any[] = first?.data?.docs || [];
    const total: number = Number(first?.data?.totalDocuments ?? first?.data?.total ?? docs.length) || docs.length;
    const pages = Math.ceil(total / PAGE_SIZE);
    if (pages <= 1) return { items: docs, complete: true, total };
    if (total > PRELOAD_MAX) return { items: docs, complete: false, total };
    const rest = await Promise.all(
      Array.from({ length: pages - 1 }, (_, i) => post("/inventories", { status: "all", page: i + 2, limit: PAGE_SIZE }))
    );
    return { items: docs.concat(...rest.map((r) => r?.data?.docs || [])), complete: true, total };
  }, [organizationId, post]);

  // Products (assets): full preload for small catalogues, first page only for
  // large ones (the Stock Card then searches the server).
  const fetchAssets = useCallback(async (): Promise<{ items: any[]; complete: boolean; total: number }> => {
    if (!organizationId) return { items: [], complete: true, total: 0 };
    const first = await post("/assets", { page: 1, limit: PAGE_SIZE });
    const docs: any[] = first?.data?.docs || [];
    const total: number = Number(first?.data?.totalDocuments ?? docs.length) || docs.length;
    const pages = Math.ceil(total / PAGE_SIZE);
    let all = docs;
    let complete = true;
    if (pages > 1 && total <= PRELOAD_MAX) {
      const rest = await Promise.all(
        Array.from({ length: pages - 1 }, (_, i) => post("/assets", { page: i + 2, limit: PAGE_SIZE }))
      );
      all = docs.concat(...rest.map((r) => r?.data?.docs || []));
    } else if (pages > 1) {
      complete = false;
    }
    return { items: all.map(mapAssetToPickerItem), complete, total };
  }, [organizationId, post]);

  // The products a document's lines reference — fetched by id so they resolve
  // (code, prices, tiers) even when they are not in the preloaded page.
  const fetchAssetsByIds = useCallback(
    async (ids: string[]) => {
      if (!organizationId || !ids.length) return [];
      const batches = await Promise.all(
        chunk([...new Set(ids)], PAGE_SIZE).map((part) => post("/assets", { page: 1, limit: PAGE_SIZE, filters: { ids: part } }))
      );
      return batches.flatMap((r) => r?.data?.docs || []).map(mapAssetToPickerItem);
    },
    [organizationId, post]
  );

  const fetchInventoriesByIds = useCallback(
    async (inventoryIds: string[]) => {
      if (!inventoryIds?.length || !organizationId) return [];
      const response = await post("/inventories/by-ids", { inventoryIds });
      return response?.data || [];
    },
    [organizationId, post]
  );

  // Server-side catalogue search for the Stock Card (large catalogues).
  const searchCatalogue = useCallback(
    async (term: string) => {
      const q = (term || "").trim();
      if (!organizationId || !q) return [];
      const response = await post("/assets", { page: 1, limit: SEARCH_LIMIT, search: q });
      return (response?.data?.docs || []).map(mapAssetToPickerItem);
    },
    [organizationId, post]
  );

  // Keep a picked item in the working set so the line-level lookups (SKU,
  // price tiers, stock card) resolve it after selection.
  const rememberItems = useCallback((items: any[]) => {
    if (!items?.length) return;
    setInventoriesForDocument((prev) => mergeById(prev, items));
  }, []);

  const getInventories = useCallback(async () => {
    if (!organizationId || !type) return [];

    const lineIds: string[] = Array.isArray(document?.config?.items)
      ? document.config.items.map((item: any) => item.inventoryItemId).filter((id: string) => id && String(id).trim() !== "")
      : [];

    // Quotations quote a product TYPE, not a committed serial-numbered unit, so
    // the Stock Card should list Assets (products) even when tracking is ON — you
    // pick the asset, not an individual inventory id.
    const isQuotationType = ["QT", "QUOTATION", "QO", "QO1", "QO2"].includes((type || "").toUpperCase());

    // In Products mode (tracking OFF) — or for quotations regardless — fetch assets only.
    if (!isAssetTrackingModeEnabled || isQuotationType) {
      const { items, complete, total } = await fetchAssets();
      const have = new Set(items.map((i) => i.id));
      const missing = lineIds.filter((id) => !have.has(id));
      const referenced = missing.length ? await fetchAssetsByIds(missing) : [];
      const inventories = mergeById(items, referenced);
      setCatalogueComplete(complete);
      setCatalogueTotal(total);
      setInventoriesForDocument(inventories);
      return inventories;
    }

    // In Assets mode (tracking ON), fetch BOTH:
    // 1. Untracked assets (products without inventory items)
    // 2. Tracked inventory items
    const [assetsResult, trackedResult] = await Promise.all([
      fetchAssets(),
      type === "RDO"
        ? fetchInventoriesByStatus("rental").then((items) => ({ items, complete: true, total: items.length }))
        : type === "DO"
          ? fetchInventoriesByStatus("instock").then((items) => ({ items, complete: true, total: items.length }))
          : fetchAllInventories(),
    ]);
    const untrackedAssets = assetsResult.items.filter((a: any) => a.quantity !== undefined);
    const trackedInventories: any[] = trackedResult.items;

    // Merge: exclude untracked assets that already have tracked inventory items
    const trackedAssetIds = new Set(trackedInventories.map((inv: any) => inv.assetId));
    let inventories = [...untrackedAssets.filter((a: any) => !trackedAssetIds.has(a.assetId)), ...trackedInventories];

    // Also fetch the units / products used in the current document, so they
    // show up even if their status changed or they sit past the preload.
    if (lineIds.length) {
      const have = new Set(inventories.map((inv) => inv.id));
      const missing = lineIds.filter((id) => !have.has(id));
      if (missing.length) {
        const [units, products] = await Promise.all([fetchInventoriesByIds(missing), fetchAssetsByIds(missing)]);
        inventories = mergeById(mergeById(inventories, units), products);
      }
    }

    setCatalogueComplete(assetsResult.complete && trackedResult.complete);
    setCatalogueTotal(assetsResult.total + trackedResult.total);
    setInventoriesForDocument(inventories);
    return inventories;
  }, [organizationId, type, document?.config?.items, fetchInventoriesByStatus, fetchAllInventories, fetchInventoriesByIds, fetchAssetsByIds, isAssetTrackingModeEnabled, fetchAssets]);

  // Fetch inventories when dependencies change
  useEffect(() => {
    getInventories();
  }, [getInventories]);

  return { inventoriesForDocument, catalogueComplete, catalogueTotal, searchCatalogue, rememberItems };
};
