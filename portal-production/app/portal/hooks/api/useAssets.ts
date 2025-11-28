import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/nextjs';
import { useOrganization } from '@hooks/useOrganization';
import { request } from '@/helpers/request';

interface Asset {
  id: string;
  name: string;
  skuKey: string;
  description?: string;
  category?: any;
  [key: string]: any;
}

interface Filters {
  createdOn?: {
    startDate: Date | string | null;
    endDate: Date | string | null;
  };
  category?: string[];
  [key: string]: any;
}

interface GetAssetsOptions {
  page?: number;
  limit?: number;
  search?: string;
  filters?: Filters;
}

// Get all assets with pagination and filters
export function useGetAssets(options: GetAssetsOptions = {}) {
  const { organization } = useOrganization();
  const { getToken } = useAuth();
  const organizationId = organization?.id;

  const { page = 1, limit = 1000, search = '', filters = {} } = options;

  const { data = { docs: [], total: 0, page: 1, limit: 1000 }, isLoading, error, refetch } = useQuery({
    queryKey: ['assets', organizationId, page, limit, search, filters],
    queryFn: async () => {
      try {
        const token = await getToken();
        if (!token || !organizationId) return { docs: [], total: 0, page: 1, limit: 1000 };

        const response = await request(
          { path: '/assets', method: 'POST' },
          { page, limit, search, filters },
          token
        );

        if (!response.success) {
          console.error('Failed to fetch assets:', response.message);
          return { docs: [], total: 0, page: 1, limit: 1000 };
        }

        return {
          docs: response.data.docs || response.data.assets || [],
          total: response.data.total || response.data.totalDocuments || 0,
          page: response.data.page || page,
          limit: response.data.limit || limit,
        };
      } catch (error) {
        console.error('Error fetching assets:', error);
        return { docs: [], total: 0, page: 1, limit: 1000 };
      }
    },
    enabled: !!organizationId,
  });

  return { assets: data.docs, total: data.total, page: data.page, limit: data.limit, isLoading, error, refetch };
}

// Get single asset by ID
export function useGetAssetById(assetId: string) {
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const organizationId = organization?.id;

  const { data: asset, isLoading, error, refetch } = useQuery({
    queryKey: ['asset', assetId],
    queryFn: async () => {
      try {
        const token = await getToken();
        if (!token || !assetId) return null;

        const response = await request(
          { path: `/assets/${assetId}`, method: 'GET' },
          {},
          token
        );

        if (!response.success) {
          console.error('Failed to fetch asset:', response.message);
          return null;
        }

        return response.data;
      } catch (error) {
        console.error('Error fetching asset:', error);
        return null;
      }
    },
    enabled: !!assetId && !!organizationId,
  });

  return { asset, isLoading, error, refetch };
}

// Get asset by SKU key
export function useGetAssetBySkuKey(skuKey: string) {
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const organizationId = organization?.id;

  const { data: asset, isLoading, error, refetch } = useQuery({
    queryKey: ['asset', 'skuKey', skuKey],
    queryFn: async () => {
      try {
        const token = await getToken();
        if (!token || !skuKey) return null;

        const response = await request(
          { path: `/assets/skuKey/${skuKey}`, method: 'GET' },
          {},
          token
        );

        if (!response.success) {
          console.error('Failed to fetch asset by SKU key:', response.message);
          return null;
        }

        return response.data;
      } catch (error) {
        console.error('Error fetching asset by SKU key:', error);
        return null;
      }
    },
    enabled: !!skuKey && !!organizationId,
  });

  return { asset, isLoading, error, refetch };
}

// Create asset mutation
export function useCreateAsset() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (assetData: Partial<Asset>) => {
      const token = await getToken();
      if (!token) throw new Error('No authentication token available');

      const response = await request(
        { path: '/assets/create', method: 'POST' },
        assetData,
        token
      );

      if (!response.success) {
        throw new Error(response.message || 'Failed to create asset');
      }

      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assets'] });
    },
  });
}

// Update asset mutation
export function useUpdateAsset() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (assetData: Partial<Asset> & { id: string }) => {
      const token = await getToken();
      if (!token) throw new Error('No authentication token available');

      const response = await request(
        { path: '/assets/update', method: 'PUT' },
        assetData,
        token
      );

      if (!response.success) {
        throw new Error(response.message || 'Failed to update asset');
      }

      return response.data;
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      queryClient.invalidateQueries({ queryKey: ['asset', variables.id] });
    },
  });
}

// Delete asset mutation
export function useDeleteAsset() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (assetId: string) => {
      const token = await getToken();
      if (!token) throw new Error('No authentication token available');

      const response = await request(
        { path: '/assets/delete', method: 'DELETE' },
        { id: assetId },
        token
      );

      if (!response.success) {
        throw new Error(response.message || 'Failed to delete asset');
      }

      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assets'] });
    },
  });
}

// Check if SKU key exists
export function useCheckSkuKey(skuKey: string) {
  const { getToken } = useAuth();

  const { data, isLoading, error } = useQuery({
    queryKey: ['checkSkuKey', skuKey],
    queryFn: async () => {
      try {
        const token = await getToken();
        if (!token || !skuKey) return null;

        const response = await request(
          { path: `/assets/check-skuKey/${skuKey}`, method: 'GET' },
          {},
          token
        );

        if (!response.success) {
          console.error('Failed to check SKU key:', response.message);
          return null;
        }

        return response.data;
      } catch (error) {
        console.error('Error checking SKU key:', error);
        return null;
      }
    },
    enabled: !!skuKey,
  });

  return { data, isLoading, error };
}
