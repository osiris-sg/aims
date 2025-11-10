import { useMutation } from '@tanstack/react-query';
import { useAuth } from '@clerk/nextjs';
import { useOrganization } from '@hooks/useOrganization';
import { request } from '@/helpers/request';

interface AgingBucket {
  current: number;
  days30: number;
  days60: number;
  days90: number;
  days120Plus: number;
}

interface Transaction {
  id: string;
  date: string;
  reference: string;
  description: string;
  transactionType: string;
  debit: number;
  credit: number;
  balance: number;
  documentType?: string;
  paymentMethod?: string;
}

interface MonthlyBalance {
  month: string;
  debit: number;
  credit: number;
  balance: number;
}

interface Customer {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
}

interface StatementData {
  customer: Customer;
  statement: {
    openingBalance: number;
    currentBalance: number;
    totalDebit: number;
    totalCredit: number;
    transactionCount: number;
  };
  transactions: Transaction[];
  monthlyBalances: MonthlyBalance[];
  agingAnalysis: AgingBucket | null;
  generatedAt: string;
}

interface GenerateSOAParams {
  customerId: string;
  startDate?: string;
  endDate?: string;
  includeAging?: boolean;
  format?: 'json' | 'csv';
}

// Generate Statement of Account
export function useGenerateSOA() {
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const organizationId = organization?.id;

  return useMutation<StatementData, Error, GenerateSOAParams>({
    mutationFn: async (params: GenerateSOAParams) => {
      const token = await getToken();
      if (!token || !organizationId) {
        throw new Error('No authentication token or organization available');
      }

      const response = await request(
        { path: '/statements/soa', method: 'POST' },
        params,
        token
      );

      if (!response.success) {
        throw new Error(response.message || 'Failed to generate statement of account');
      }

      return response.data;
    },
  });
}

// Get aging summary for all customers
export function useGetAgingSummary() {
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const organizationId = organization?.id;

  return useMutation<any, Error, void>({
    mutationFn: async () => {
      const token = await getToken();
      if (!token || !organizationId) {
        throw new Error('No authentication token or organization available');
      }

      const response = await request(
        { path: '/statements/aging-summary', method: 'GET' },
        {},
        token
      );

      if (!response.success) {
        throw new Error(response.message || 'Failed to fetch aging summary');
      }

      return response.data;
    },
  });
}
