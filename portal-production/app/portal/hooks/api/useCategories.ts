import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/nextjs';
import { useOrganization } from '@hooks/useOrganization';
import { request } from '@/helpers/request';

interface Category {
  id: string;
  name: string;
  [key: string]: any;
}

// Get all categories
export function useGetCategories() {
  const { organization } = useOrganization();
  const { getToken } = useAuth();
  const organizationId = organization?.id;

  const { data: categories = [], isLoading, error, refetch } = useQuery({
    queryKey: ['categories', organizationId],
    queryFn: async () => {
      try {
        const token = await getToken();
        if (!token || !organizationId) return [];

        const response = await request(
          { path: '/categories', method: 'GET' },
          {},
          token
        );

        if (!response.success) {
          console.error('Failed to fetch categories:', response.message);
          return [];
        }

        return response.data || [];
      } catch (error) {
        console.error('Error fetching categories:', error);
        return [];
      }
    },
    enabled: !!organizationId,
  });

  return { categories, isLoading, error, refetch };
}

// Create category mutation
export function useCreateCategory() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (categoryData: Partial<Category>) => {
      const token = await getToken();
      if (!token) throw new Error('No authentication token available');

      const response = await request(
        { path: '/categories/create', method: 'POST' },
        categoryData,
        token
      );

      if (!response.success) {
        throw new Error(response.message || 'Failed to create category');
      }

      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] });
    },
  });
}

// Update category mutation
export function useUpdateCategory() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (categoryData: Partial<Category> & { id: string }) => {
      const token = await getToken();
      if (!token) throw new Error('No authentication token available');

      const response = await request(
        { path: '/categories/update', method: 'POST' },
        categoryData,
        token
      );

      if (!response.success) {
        throw new Error(response.message || 'Failed to update category');
      }

      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] });
    },
  });
}

// Delete category mutation
export function useDeleteCategory() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (categoryId: string) => {
      const token = await getToken();
      if (!token) throw new Error('No authentication token available');

      const response = await request(
        { path: '/categories/delete', method: 'DELETE' },
        { id: categoryId },
        token
      );

      if (!response.success) {
        throw new Error(response.message || 'Failed to delete category');
      }

      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] });
    },
  });
}
