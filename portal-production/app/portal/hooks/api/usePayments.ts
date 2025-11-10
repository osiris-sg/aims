import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/nextjs';
import { useOrganization } from '@hooks/useOrganization';
import { request } from '@/helpers/request';

interface Payment {
  id: string;
  customerId: string;
  documentId: string;
  amount: number;
  paymentDate: string;
  paymentMethod: string;
  reference?: string;
  notes?: string;
  customer?: {
    id: string;
    name: string;
  };
  document?: {
    id: string;
    name: string;
    type: string;
  };
  [key: string]: any;
}

interface GetPaymentsOptions {
  customerId?: string;
  startDate?: string;
  endDate?: string;
  paymentMethod?: string;
  page?: number;
  limit?: number;
}

// Get all payments with filters
export function useGetPayments(options: GetPaymentsOptions = {}) {
  const { organization } = useOrganization();
  const { getToken } = useAuth();
  const organizationId = organization?.id;

  const {
    customerId,
    startDate,
    endDate,
    paymentMethod,
    page = 1,
    limit = 25,
  } = options;

  const { data = { data: [], total: 0, page: 1, limit: 25 }, isLoading, error, refetch } = useQuery({
    queryKey: ['payments', organizationId, customerId, startDate, endDate, paymentMethod, page, limit],
    queryFn: async () => {
      try {
        const token = await getToken();
        if (!token || !organizationId) return { data: [], total: 0, page: 1, limit: 25 };

        const queryParams = new URLSearchParams();
        if (customerId) queryParams.append('customerId', customerId);
        if (startDate) queryParams.append('startDate', startDate);
        if (endDate) queryParams.append('endDate', endDate);
        if (paymentMethod) queryParams.append('paymentMethod', paymentMethod);
        queryParams.append('page', page.toString());
        queryParams.append('limit', limit.toString());

        const response = await request(
          { path: `/payments?${queryParams.toString()}`, method: 'GET' },
          {},
          token
        );

        if (!response.success) {
          console.error('Failed to fetch payments:', response.message);
          return { data: [], total: 0, page: 1, limit: 25 };
        }

        return {
          data: response.data.data || [],
          total: response.data.total || 0,
          page: response.data.page || page,
          limit: response.data.limit || limit,
        };
      } catch (error) {
        console.error('Error fetching payments:', error);
        return { data: [], total: 0, page: 1, limit: 25 };
      }
    },
    enabled: !!organizationId,
  });

  return { payments: data.data, total: data.total, page: data.page, limit: data.limit, isLoading, error, refetch };
}

// Get single payment by ID
export function useGetPaymentById(paymentId: string) {
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const organizationId = organization?.id;

  const { data: payment, isLoading, error, refetch } = useQuery({
    queryKey: ['payment', paymentId],
    queryFn: async () => {
      try {
        const token = await getToken();
        if (!token || !paymentId) return null;

        const response = await request(
          { path: `/payments/${paymentId}`, method: 'GET' },
          {},
          token
        );

        if (!response.success) {
          console.error('Failed to fetch payment:', response.message);
          return null;
        }

        return response.data;
      } catch (error) {
        console.error('Error fetching payment:', error);
        return null;
      }
    },
    enabled: !!paymentId && !!organizationId,
  });

  return { payment, isLoading, error, refetch };
}

// Get payments by document
export function useGetPaymentsByDocument(documentId: string) {
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const organizationId = organization?.id;

  const { data: payments = [], isLoading, error, refetch } = useQuery({
    queryKey: ['payments', 'document', documentId],
    queryFn: async () => {
      try {
        const token = await getToken();
        if (!token || !documentId) return [];

        const response = await request(
          { path: `/payments/document/${documentId}`, method: 'GET' },
          {},
          token
        );

        if (!response.success) {
          console.error('Failed to fetch payments by document:', response.message);
          return [];
        }

        return response.data || [];
      } catch (error) {
        console.error('Error fetching payments by document:', error);
        return [];
      }
    },
    enabled: !!documentId && !!organizationId,
  });

  return { payments, isLoading, error, refetch };
}

// Create payment mutation
export function useCreatePayment() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (paymentData: {
      customerId: string;
      documentId: string;
      amount: number;
      paymentDate: string;
      paymentMethod: string;
      reference?: string;
      notes?: string;
    }) => {
      const token = await getToken();
      if (!token) throw new Error('No authentication token available');

      const response = await request(
        { path: '/payments', method: 'POST' },
        paymentData,
        token
      );

      if (!response.success) {
        throw new Error(response.message || 'Failed to create payment');
      }

      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['statements'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
  });
}

// Update payment mutation
export function useUpdatePayment() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ paymentId, paymentData }: { paymentId: string; paymentData: Partial<Payment> }) => {
      const token = await getToken();
      if (!token) throw new Error('No authentication token available');

      const response = await request(
        { path: `/payments/${paymentId}`, method: 'PATCH' },
        paymentData,
        token
      );

      if (!response.success) {
        throw new Error(response.message || 'Failed to update payment');
      }

      return response.data;
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['payment', variables.paymentId] });
      queryClient.invalidateQueries({ queryKey: ['statements'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
  });
}

// Delete payment mutation
export function useDeletePayment() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (paymentId: string) => {
      const token = await getToken();
      if (!token) throw new Error('No authentication token available');

      const response = await request(
        { path: `/payments/${paymentId}`, method: 'DELETE' },
        {},
        token
      );

      if (!response.success) {
        throw new Error(response.message || 'Failed to delete payment');
      }

      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['statements'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
  });
}

export const PAYMENT_METHODS = [
  { label: 'Cash', value: 'cash' },
  { label: 'Check', value: 'check' },
  { label: 'Bank Transfer', value: 'transfer' },
  { label: 'Credit Card', value: 'credit_card' },
  { label: 'Other', value: 'other' },
];
