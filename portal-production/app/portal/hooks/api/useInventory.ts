import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";

interface Inventory {
  id: string;
  sku: string;
  status: string;
  asset?: any;
  [key: string]: any;
}

interface Filters {
  createdOn?: {
    startDate: Date | string | null;
    endDate: Date | string | null;
  };
  status?: string[];
  category?: string[];
  [key: string]: any;
}

interface GetInventoryOptions {
  page?: number;
  limit?: number;
  search?: string;
  filters?: Filters;
}

// Get all inventory with pagination and filters
export function useGetInventory(options: GetInventoryOptions = {}) {
  const { organization } = useOrganization();
  const { getToken } = useAuth();
  const organizationId = organization?.id;

  const { page = 1, limit = 1000, search = "", filters = {} } = options;

  const {
    data = { docs: [], total: 0, page: 1, limit: 1000 },
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["inventory-v2", organizationId, page, limit, search, filters], // Changed key to bust cache
    queryFn: async () => {
      try {
        const token = await getToken();
        if (!token || !organizationId) {
          return { docs: [], total: 0, page: 1, limit: 1000 };
        }

        const response = await request({ path: "/inventories", method: "POST" }, { page, limit, search, filters }, token);

        if (!response.success) {
          console.error("Failed to fetch inventory:", response.message);
          return { docs: [], total: 0, page: 1, limit: 1000 };
        }

        return {
          docs: response.data.docs || response.data.inventories || [],
          total: response.data.total || response.data.totalDocuments || 0,
          page: response.data.page || page,
          limit: response.data.limit || limit,
        };
      } catch (error) {
        console.error("Error fetching inventory:", error);
        return { docs: [], total: 0, page: 1, limit: 1000 };
      }
    },
    enabled: !!organizationId,
  });

  return { inventories: data.docs, total: data.total, page: data.page, limit: data.limit, isLoading, error, refetch };
}

// Get single inventory by SKU
export function useGetInventoryBySku(sku: string) {
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const organizationId = organization?.id;

  const {
    data: inventory,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["inventory", "sku", sku],
    queryFn: async () => {
      try {
        const token = await getToken();
        if (!token || !sku) return null;

        const response = await request({ path: `/inventories/sku/${sku}`, method: "GET" }, {}, token);

        if (!response.success) {
          console.error("Failed to fetch inventory:", response.message);
          return null;
        }

        return response.data;
      } catch (error) {
        console.error("Error fetching inventory:", error);
        return null;
      }
    },
    enabled: !!sku && !!organizationId,
  });

  return { inventory, isLoading, error, refetch };
}

// Get inventory by status
export function useGetInventoryByStatus(status: string[]) {
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const organizationId = organization?.id;

  const {
    data: inventories = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["inventory", "status", status, organizationId],
    queryFn: async () => {
      try {
        const token = await getToken();
        if (!token || !status || status.length === 0) return [];

        const response = await request({ path: "/inventories/by-status", method: "POST" }, { status }, token);

        if (!response.success) {
          console.error("Failed to fetch inventory by status:", response.message);
          return [];
        }

        return response.data || [];
      } catch (error) {
        console.error("Error fetching inventory by status:", error);
        return [];
      }
    },
    enabled: !!status && status.length > 0 && !!organizationId,
  });

  return { inventories, isLoading, error, refetch };
}

// Get inventories by IDs
export function useGetInventoriesByIds(ids: string[]) {
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const organizationId = organization?.id;

  const {
    data: inventories = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["inventory", "ids", ids, organizationId],
    queryFn: async () => {
      try {
        const token = await getToken();
        if (!token || !ids || ids.length === 0) return [];

        const response = await request({ path: "/inventories/by-ids", method: "POST" }, { ids }, token);

        if (!response.success) {
          console.error("Failed to fetch inventories by IDs:", response.message);
          return [];
        }

        return response.data || [];
      } catch (error) {
        console.error("Error fetching inventories by IDs:", error);
        return [];
      }
    },
    enabled: !!ids && ids.length > 0 && !!organizationId,
  });

  return { inventories, isLoading, error, refetch };
}

// Get inventories by asset
export function useGetInventoriesByAsset(assetId: string) {
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const organizationId = organization?.id;

  const {
    data = { inventories: [], statusCounts: {} },
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["inventoryByAsset", assetId],
    queryFn: async () => {
      try {
        const token = await getToken();
        if (!token || !assetId) return { inventories: [], statusCounts: {} };

        const response = await request({ path: `/inventories/asset/${assetId}`, method: "GET" }, {}, token);

        if (!response.success) {
          console.error("Failed to fetch inventories by asset:", response.message);
          return { inventories: [], statusCounts: {} };
        }

        return {
          inventories: response.data.inventories || [],
          statusCounts: response.data.statusCounts || {},
        };
      } catch (error) {
        console.error("Error fetching inventories by asset:", error);
        return { inventories: [], statusCounts: {} };
      }
    },
    enabled: !!assetId && !!organizationId,
  });

  return { inventories: data.inventories, statusCounts: data.statusCounts, isLoading, error, refetch };
}

// Get documents for an inventory
export function useGetDocumentsByInventoryId(inventoryId: string) {
  const { getToken } = useAuth();

  const {
    data: documents = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["documents", "inventory", inventoryId],
    queryFn: async () => {
      try {
        const token = await getToken();
        if (!token || !inventoryId) return [];

        const response = await request({ path: `/documents/inventory/${inventoryId}`, method: "GET" }, {}, token);

        if (!response.success) {
          console.error("Failed to fetch documents:", response.message);
          return [];
        }

        return response.data || [];
      } catch (error) {
        console.error("Error fetching documents:", error);
        return [];
      }
    },
    enabled: !!inventoryId,
  });

  return { documents, isLoading, error, refetch };
}

// Get timeline items for an inventory
export function useGetTimelineItemsByInventoryId(inventoryId: string) {
  const { getToken } = useAuth();

  const {
    data: timelineItems = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["timelineItems", "inventory", inventoryId],
    queryFn: async () => {
      try {
        const token = await getToken();
        if (!token || !inventoryId) return [];

        const response = await request({ path: `/timeline-items/inventory/${inventoryId}`, method: "GET" }, {}, token);

        if (!response.success) {
          console.error("Failed to fetch timeline items:", response.message);
          return [];
        }

        return response.data || [];
      } catch (error) {
        console.error("Error fetching timeline items:", error);
        return [];
      }
    },
    enabled: !!inventoryId,
  });

  return { timelineItems, isLoading, error, refetch };
}

// Create inventory mutation
export function useCreateInventory() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (inventoryData: Partial<Inventory>) => {
      const token = await getToken();
      if (!token) throw new Error("No authentication token available");

      const response = await request({ path: "/inventories/create", method: "POST" }, inventoryData, token);

      if (!response.success) {
        throw new Error(response.message || "Failed to create inventory");
      }

      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      queryClient.invalidateQueries({ queryKey: ["inventoryByAsset"] });
    },
  });
}

// Update inventory mutation
export function useUpdateInventory() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (inventoryData: Partial<Inventory> & { id: string }) => {
      const token = await getToken();
      if (!token) throw new Error("No authentication token available");

      const response = await request({ path: "/inventories/update", method: "POST" }, inventoryData, token);

      if (!response.success) {
        throw new Error(response.message || "Failed to update inventory");
      }

      return response.data;
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      queryClient.invalidateQueries({ queryKey: ["inventory", "sku", variables.sku] });
      queryClient.invalidateQueries({ queryKey: ["inventoryByAsset"] });
    },
  });
}

// Delete inventory mutation
export function useDeleteInventory() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (inventoryId: string) => {
      const token = await getToken();
      if (!token) throw new Error("No authentication token available");

      const response = await request({ path: "/inventories/delete", method: "DELETE" }, { id: inventoryId }, token);

      if (!response.success) {
        throw new Error(response.message || "Failed to delete inventory");
      }

      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      queryClient.invalidateQueries({ queryKey: ["inventoryByAsset"] });
    },
  });
}

// Generate SKU mutation
export function useGenerateSku() {
  const { getToken } = useAuth();

  return useMutation({
    mutationFn: async (assetId: string) => {
      const token = await getToken();
      if (!token) throw new Error("No authentication token available");

      const response = await request({ path: "/inventories/generate-sku", method: "POST" }, { assetId }, token);

      if (!response.success) {
        throw new Error(response.message || "Failed to generate SKU");
      }

      return response.data;
    },
  });
}

// Get QR code for inventory
export function useGetQrCode(sku: string) {
  const { getToken } = useAuth();

  const {
    data: qrCode,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["qrCode", sku],
    queryFn: async () => {
      try {
        const token = await getToken();
        if (!token || !sku) return null;

        const response = await request({ path: `/inventories/qrcode/${sku}`, method: "GET" }, {}, token);

        if (!response.success) {
          console.error("Failed to fetch QR code:", response.message);
          return null;
        }

        return response.data;
      } catch (error) {
        console.error("Error fetching QR code:", error);
        return null;
      }
    },
    enabled: !!sku,
  });

  return { qrCode, isLoading, error, refetch };
}

export const INVENTORY_STATUS = [
  { label: "Rental", value: "rental" },
  { label: "Reserved", value: "reserved" },
  { label: "Maintenance", value: "maintenance" },
  { label: "Sold", value: "sold" },
  { label: "Instock", value: "instock" },
];
