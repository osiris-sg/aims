import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/nextjs';
import { useOrganization } from '@hooks/useOrganization';
import { request } from '@/helpers/request';

interface Supplier {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  gstRegNo?: string;
  supplierCode?: string;
  [key: string]: any;
}

interface Filters {
  createdOn?: {
    startDate: Date | string | null;
    endDate: Date | string | null;
  };
  [key: string]: any;
}

interface GetSuppliersOptions {
  page?: number;
  limit?: number;
  search?: string;
  filters?: Filters;
}

// Get all suppliers with pagination and filters
export function useGetSuppliers(options: GetSuppliersOptions = {}) {
  const { organization } = useOrganization();
  const { getToken } = useAuth();
  const organizationId = organization?.id;

  const { page = 1, limit = 1000, search = '', filters = {} } = options;

  const { data = { docs: [], total: 0, page: 1, limit: 1000 }, isLoading, error, refetch } = useQuery({
    queryKey: ['suppliers', organizationId, page, limit, search, filters],
    queryFn: async () => {
      try {
        const token = await getToken();
        if (!token || !organizationId) return { docs: [], total: 0, page: 1, limit: 1000 };

        const response = await request(
          { path: '/suppliers', method: 'POST' },
          { page, limit, search, filters },
          token
        );

        if (!response.success) {
          console.error('Failed to fetch suppliers:', response.message);
          return { docs: [], total: 0, page: 1, limit: 1000 };
        }

        return {
          docs: response.data.docs || [],
          total: response.data.totalDocuments || 0,
          page: response.data.page || page,
          limit: response.data.limit || limit,
        };
      } catch (error) {
        console.error('Error fetching suppliers:', error);
        return { docs: [], total: 0, page: 1, limit: 1000 };
      }
    },
    enabled: !!organizationId,
  });

  return { suppliers: data.docs, total: data.total, page: data.page, limit: data.limit, isLoading, error, refetch };
}

// Get single supplier by ID
export function useGetSupplierById(supplierId: string) {
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const organizationId = organization?.id;

  const { data: supplier, isLoading, error, refetch } = useQuery({
    queryKey: ['supplier', supplierId],
    queryFn: async () => {
      try {
        const token = await getToken();
        if (!token || !supplierId) return null;

        const response = await request(
          { path: `/suppliers/${supplierId}`, method: 'GET' },
          {},
          token
        );

        if (!response.success) {
          console.error('Failed to fetch supplier:', response.message);
          return null;
        }

        return response.data;
      } catch (error) {
        console.error('Error fetching supplier:', error);
        return null;
      }
    },
    enabled: !!supplierId && !!organizationId,
  });

  return { supplier, isLoading, error, refetch };
}

// Create supplier mutation
export function useCreateSupplier() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (supplierData: Partial<Supplier>) => {
      const token = await getToken();
      if (!token) throw new Error('No authentication token available');

      const response = await request(
        { path: '/suppliers/create', method: 'POST' },
        supplierData,
        token
      );

      if (!response.success) {
        throw new Error(response.message || 'Failed to create supplier');
      }

      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
    },
  });
}

// Update supplier mutation
export function useUpdateSupplier() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (supplierData: Partial<Supplier> & { id: string }) => {
      const token = await getToken();
      if (!token) throw new Error('No authentication token available');

      const response = await request(
        { path: '/suppliers/update', method: 'PUT' },
        supplierData,
        token
      );

      if (!response.success) {
        throw new Error(response.message || 'Failed to update supplier');
      }

      return response.data;
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      queryClient.invalidateQueries({ queryKey: ['supplier', variables.id] });
    },
  });
}

// Delete supplier mutation
export function useDeleteSupplier() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (supplierId: string) => {
      const token = await getToken();
      if (!token) throw new Error('No authentication token available');

      const response = await request(
        { path: '/suppliers/delete', method: 'DELETE' },
        { id: supplierId },
        token
      );

      if (!response.success) {
        throw new Error(response.message || 'Failed to delete supplier');
      }

      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
    },
  });
}
