import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";

export interface CustomerInfoRow {
  id: string;
  customerName: string;
  projectName: string;
  createdAt: string;
  submittedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  submissionCount: number;
  status: string; // awaiting | submitted | expired | revoked
}

export interface CustomerInfoContact {
  id: string;
  group: "DO" | "INVOICE";
  name: string;
  email: string | null;
  phone: string | null;
}

export interface CustomerInfoDetail {
  id: string;
  customerId: string;
  projectId: string;
  customerName: string;
  projectName: string;
  status: string;
  token: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  submittedAt: string | null;
  submissionCount: number;
  poDocumentId: string | null;
  poNumber: string | null;
  poDocumentName: string | null;
  poDocumentType: string | null;
  poTemplateId: string | null;
  doContacts: CustomerInfoContact[];
  invoiceContacts: CustomerInfoContact[];
}

interface ListOptions {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
}

// Paginated list of collection requests for the current org.
export function useGetCustomerInfoRequests(options: ListOptions = {}) {
  const { organization } = useOrganization();
  const { getToken } = useAuth();
  const organizationId = organization?.id;
  const { page = 1, limit = 10, search = "", status = "" } = options;

  const { data = { docs: [], total: 0, totalPages: 1 }, isLoading, error, refetch } = useQuery({
    queryKey: ["customer-info", organizationId, page, limit, search, status],
    queryFn: async () => {
      const token = await getToken();
      if (!token || !organizationId) return { docs: [], total: 0, totalPages: 1 };
      const qs = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (search) qs.set("search", search);
      if (status) qs.set("status", status);
      const res = await request({ path: `/customer-info?${qs.toString()}`, method: "GET" }, {}, token);
      const body = res?.data ?? res;
      return {
        docs: (body?.docs ?? []) as CustomerInfoRow[],
        total: body?.total ?? 0,
        totalPages: body?.totalPages ?? 1,
      };
    },
    enabled: !!organizationId,
  });

  return { docs: data.docs, total: data.total, totalPages: data.totalPages, isLoading, error, refetch };
}

// Single collection request with its current contacts.
export function useGetCustomerInfoRequest(id: string | undefined) {
  const { organization } = useOrganization();
  const { getToken } = useAuth();
  const organizationId = organization?.id;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["customer-info", organizationId, id],
    queryFn: async () => {
      const token = await getToken();
      if (!token || !id) return null;
      const res = await request({ path: `/customer-info/${id}`, method: "GET" }, {}, token);
      return (res?.data ?? res) as CustomerInfoDetail;
    },
    enabled: !!organizationId && !!id,
  });

  return { detail: data as CustomerInfoDetail | undefined, isLoading, error, refetch };
}
