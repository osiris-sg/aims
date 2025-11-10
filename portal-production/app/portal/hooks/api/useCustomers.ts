import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/nextjs';
import { useOrganization } from '@hooks/useOrganization';
import { request } from '@/helpers/request';

interface Customer {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  gstRegistrationNumber?: string;
  [key: string]: any;
}

interface Filters {
  createdOn?: {
    startDate: Date | string | null;
    endDate: Date | string | null;
  };
  [key: string]: any;
}

interface GetCustomersOptions {
  page?: number;
  limit?: number;
  search?: string;
  filters?: Filters;
}

// Get all customers with pagination and filters
export function useGetCustomers(options: GetCustomersOptions = {}) {
  const { organization } = useOrganization();
  const { getToken } = useAuth();
  const organizationId = organization?.id;

  const { page = 1, limit = 1000, search = '', filters = {} } = options;

  const { data = { docs: [], total: 0, page: 1, limit: 1000 }, isLoading, error, refetch } = useQuery({
    queryKey: ['customers', organizationId, page, limit, search, filters],
    queryFn: async () => {
      try {
        console.log('=== useGetCustomers Hook - queryFn called ===');
        console.log('organizationId:', organizationId);

        const token = await getToken();
        console.log('token available:', !!token);

        if (!token || !organizationId) {
          console.log('No token or organizationId, returning empty');
          return { docs: [], total: 0, page: 1, limit: 1000 };
        }

        console.log('Making API request to /customers with:', { page, limit, search, filters });
        const response = await request(
          { path: '/customers', method: 'POST' },
          { page, limit, search, filters },
          token
        );

        console.log('API Response:', response);
        console.log('response.success:', response.success);
        console.log('response.data:', response.data);
        console.log('response.data.docs:', response.data?.docs);

        if (!response.success) {
          console.error('Failed to fetch customers:', response.message);
          return { docs: [], total: 0, page: 1, limit: 1000 };
        }

        const result = {
          docs: response.data.docs || [],
          total: response.data.total || 0,
          page: response.data.page || page,
          limit: response.data.limit || limit,
        };

        console.log('Returning result:', result);
        console.log('result.docs length:', result.docs.length);
        console.log('==========================================');

        return result;
      } catch (error) {
        console.error('Error fetching customers:', error);
        return { docs: [], total: 0, page: 1, limit: 1000 };
      }
    },
    enabled: !!organizationId,
  });

  return { customers: data.docs, total: data.total, page: data.page, limit: data.limit, isLoading, error, refetch };
}

// Get single customer by ID
export function useGetCustomerById(customerId: string) {
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const organizationId = organization?.id;

  const { data: customer, isLoading, error, refetch } = useQuery({
    queryKey: ['customer', customerId],
    queryFn: async () => {
      try {
        const token = await getToken();
        if (!token || !customerId) return null;

        const response = await request(
          { path: `/customers/${customerId}`, method: 'GET' },
          {},
          token
        );

        if (!response.success) {
          console.error('Failed to fetch customer:', response.message);
          return null;
        }

        return response.data;
      } catch (error) {
        console.error('Error fetching customer:', error);
        return null;
      }
    },
    enabled: !!customerId && !!organizationId,
  });

  return { customer, isLoading, error, refetch };
}

// Create customer mutation
export function useCreateCustomer() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (customerData: Partial<Customer>) => {
      const token = await getToken();
      if (!token) throw new Error('No authentication token available');

      const response = await request(
        { path: '/customers/create', method: 'POST' },
        customerData,
        token
      );

      if (!response.success) {
        throw new Error(response.message || 'Failed to create customer');
      }

      return response.data;
    },
    onSuccess: () => {
      // Invalidate customers list to refetch
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
  });
}

// Update customer mutation
export function useUpdateCustomer() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (customerData: Partial<Customer> & { id: string }) => {
      const token = await getToken();
      if (!token) throw new Error('No authentication token available');

      const response = await request(
        { path: '/customers/update', method: 'PUT' },
        customerData,
        token
      );

      if (!response.success) {
        throw new Error(response.message || 'Failed to update customer');
      }

      return response.data;
    },
    onSuccess: (data, variables) => {
      // Invalidate customers list and specific customer
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['customer', variables.id] });
    },
  });
}

// Delete customer mutation
export function useDeleteCustomer() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (customerId: string) => {
      const token = await getToken();
      if (!token) throw new Error('No authentication token available');

      const response = await request(
        { path: '/customers/delete', method: 'DELETE' },
        { id: customerId },
        token
      );

      if (!response.success) {
        throw new Error(response.message || 'Failed to delete customer');
      }

      return response.data;
    },
    onSuccess: () => {
      // Invalidate customers list to refetch
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
  });
}

// Get site offices for a customer
export function useGetSiteOffices(customerId: string) {
  const { getToken } = useAuth();

  const { data: siteOffices = [], isLoading, error, refetch } = useQuery({
    queryKey: ['siteOffices', customerId],
    queryFn: async () => {
      try {
        const token = await getToken();
        if (!token || !customerId) return [];

        const response = await request(
          { path: `/customers/${customerId}/site-offices`, method: 'GET' },
          {},
          token
        );

        if (!response.success) {
          console.error('Failed to fetch site offices:', response.message);
          return [];
        }

        return response.data || [];
      } catch (error) {
        console.error('Error fetching site offices:', error);
        return [];
      }
    },
    enabled: !!customerId,
  });

  return { siteOffices, isLoading, error, refetch };
}
