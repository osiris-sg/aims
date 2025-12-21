import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/nextjs';
import { request } from '@/helpers/request';

interface AdjustQuantityParams {
  assetId: string;
  amount: number;
  type: 'ADD' | 'SUBTRACT' | 'SET';
  reason?: string;
}

interface QuantityHistoryParams {
  assetId: string;
  page?: number;
  limit?: number;
}

export function useAdjustQuantity() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: AdjustQuantityParams) => {
      const token = await getToken();
      if (!token) throw new Error('No authentication token available');

      const response = await request(
        { path: '/assets/adjust-quantity', method: 'POST' },
        params,
        token
      );

      if (!response.success) {
        throw new Error(response.message || 'Failed to adjust quantity');
      }

      return response.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['asset', 'skuKey'] });
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      queryClient.invalidateQueries({ queryKey: ['quantityHistory', variables.assetId] });
    },
  });
}

export function useQuantityHistory(params: QuantityHistoryParams) {
  const { getToken } = useAuth();
  const { assetId, page = 1, limit = 10 } = params;

  return useQuery({
    queryKey: ['quantityHistory', assetId, page, limit],
    queryFn: async () => {
      const token = await getToken();
      if (!token || !assetId) return { docs: [], totalDocuments: 0 };

      const response = await request(
        { path: `/assets/${assetId}/quantity-history?page=${page}&limit=${limit}`, method: 'GET' },
        {},
        token
      );

      if (!response.success) {
        console.error('Failed to fetch quantity history:', response.message);
        return { docs: [], totalDocuments: 0 };
      }

      return response.data;
    },
    enabled: !!assetId,
  });
}

export function useCanSwitchTrackingMode(assetId: string) {
  const { getToken } = useAuth();

  return useQuery({
    queryKey: ['canSwitchMode', assetId],
    queryFn: async () => {
      const token = await getToken();
      if (!token || !assetId) return null;

      const response = await request(
        { path: `/assets/${assetId}/can-switch-mode`, method: 'GET' },
        {},
        token
      );

      if (!response.success) {
        console.error('Failed to check switch mode:', response.message);
        return null;
      }

      return response.data;
    },
    enabled: !!assetId,
  });
}
