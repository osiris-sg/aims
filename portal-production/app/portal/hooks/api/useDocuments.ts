import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/nextjs';
import { useOrganization } from '@hooks/useOrganization';
import { request } from '@/helpers/request';

interface Document {
  id: string;
  name: string;
  type: string;
  status?: string;
  [key: string]: any;
}

interface DocumentTemplate {
  id: string;
  name: string;
  type: string;
  [key: string]: any;
}

interface GetDocumentsOptions {
  page?: number;
  limit?: number;
  search?: string;
  filters?: any;
}

// Get all documents
export function useGetDocuments(options: GetDocumentsOptions = {}) {
  const { organization } = useOrganization();
  const { getToken } = useAuth();
  const organizationId = organization?.id;

  const { data: documents = [], isLoading, error, refetch } = useQuery({
    queryKey: ['documents', organizationId],
    queryFn: async () => {
      try {
        const token = await getToken();
        if (!token || !organizationId) return [];

        const response = await request(
          { path: '/documents', method: 'POST' },
          { organizationId },
          token
        );

        if (!response.success) {
          console.error('Failed to fetch documents:', response.message);
          return [];
        }

        return response.data || [];
      } catch (error) {
        console.error('Error fetching documents:', error);
        return [];
      }
    },
    enabled: !!organizationId,
  });

  return { documents, isLoading, error, refetch };
}

interface PaginatedDocsOptions {
  page?: number;
  limit?: number;
  search?: string;
  documentTypes?: string[];
  excludeTypes?: string[];
  status?: string | string[];
  customerId?: string;
  createdOn?: { startDate: any; endDate: any };
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  enabled?: boolean;
}

// Server-side paginated / filtered / sorted document list (POST /documents/paginated).
export function useGetDocumentsPaginated(options: PaginatedDocsOptions = {}) {
  const { organization } = useOrganization();
  const { getToken } = useAuth();
  const organizationId = organization?.id;
  const { enabled = true, ...params } = options;

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['documents-paginated', organizationId, params],
    queryFn: async () => {
      const token = await getToken();
      if (!token || !organizationId) return { docs: [], total: 0, totalPages: 0 };
      const response = await request({ path: '/documents/paginated', method: 'POST' }, params, token);
      if (!response.success) {
        console.error('Failed to fetch documents (paginated):', response.message);
        return { docs: [], total: 0, totalPages: 0 };
      }
      return response.data || { docs: [], total: 0, totalPages: 0 };
    },
    enabled: !!organizationId && enabled,
    placeholderData: (prev) => prev, // keep old rows visible while paging/sorting
  });

  return {
    docs: data?.docs || [],
    total: data?.total || 0,
    totalPages: data?.totalPages || 0,
    isLoading,
    isFetching,
    error,
    refetch,
  };
}

// Stat-card counts (total / this-month / drafts) for a document-type set.
export function useGetDocumentStats(documentTypes?: string[]) {
  const { organization } = useOrganization();
  const { getToken } = useAuth();
  const organizationId = organization?.id;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['document-stats', organizationId, documentTypes],
    queryFn: async () => {
      const token = await getToken();
      if (!token || !organizationId) return { total: 0, thisMonth: 0, drafts: 0 };
      const response = await request({ path: '/documents/stats', method: 'POST' }, { documentTypes }, token);
      return response.success ? (response.data || { total: 0, thisMonth: 0, drafts: 0 }) : { total: 0, thisMonth: 0, drafts: 0 };
    },
    enabled: !!organizationId,
  });

  return {
    stats: data || { total: 0, thisMonth: 0, drafts: 0 },
    isLoading,
    refetch,
  };
}

// Get document by ID
export function useGetDocumentById(documentId: string) {
  const { getToken } = useAuth();

  const { data: document, isLoading, error, refetch } = useQuery({
    queryKey: ['document', documentId],
    queryFn: async () => {
      try {
        const token = await getToken();
        if (!token || !documentId) return null;

        const response = await request(
          { path: `/documents/${documentId}`, method: 'GET' },
          {},
          token
        );

        if (!response.success) {
          console.error('Failed to fetch document:', response.message);
          return null;
        }

        return response.data;
      } catch (error) {
        console.error('Error fetching document:', error);
        return null;
      }
    },
    enabled: !!documentId,
  });

  return { document, isLoading, error, refetch };
}

// Create document with timeline
export function useCreateDocumentWithTimeline() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (documentData: any) => {
      const token = await getToken();
      if (!token) throw new Error('No authentication token available');

      const response = await request(
        { path: '/documents/with-timeline', method: 'POST' },
        documentData,
        token
      );

      if (!response.success) {
        throw new Error(response.message || 'Failed to create document');
      }

      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] });
    },
  });
}

// Update document
export function useUpdateDocument() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (documentData: Partial<Document> & { id: string }) => {
      const token = await getToken();
      if (!token) throw new Error('No authentication token available');

      const response = await request(
        { path: '/documents/update', method: 'POST' },
        documentData,
        token
      );

      if (!response.success) {
        throw new Error(response.message || 'Failed to update document');
      }

      return response.data;
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      queryClient.invalidateQueries({ queryKey: ['document', variables.id] });
    },
  });
}

// Delete document
export function useDeleteDocument() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (documentId: string) => {
      const token = await getToken();
      if (!token) throw new Error('No authentication token available');

      const response = await request(
        { path: `/documents/delete/${documentId}`, method: 'DELETE' },
        {},
        token
      );

      if (!response.success) {
        throw new Error(response.message || 'Failed to delete document');
      }

      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] });
    },
  });
}

// Get all document templates
export function useGetDocumentTemplates(options: { page?: number; limit?: number; search?: string; filters?: any } = {}) {
  const { getToken } = useAuth();
  const { page = 1, limit = 1000, search = '', filters = {} } = options;

  const { data = { docs: [], total: 0, page: 1, limit: 1000 }, isLoading, error, refetch } = useQuery({
    queryKey: ['documentTemplates', page, limit, search, filters],
    queryFn: async () => {
      try {
        const token = await getToken();
        if (!token) return { docs: [], total: 0, page: 1, limit: 1000 };

        const response = await request(
          { path: '/documentTemplates', method: 'POST' },
          { page, limit, search, filters },
          token
        );

        if (!response.success) {
          console.error('Failed to fetch document templates:', response.message);
          return { docs: [], total: 0, page: 1, limit: 1000 };
        }

        return {
          docs: response.data.docs || response.data.documentTemplates || [],
          total: response.data.total || response.data.totalDocuments || 0,
          page: response.data.page || page,
          limit: response.data.limit || limit,
        };
      } catch (error) {
        console.error('Error fetching document templates:', error);
        return { docs: [], total: 0, page: 1, limit: 1000 };
      }
    },
  });

  return { documentTemplates: data.docs, total: data.total, page: data.page, limit: data.limit, isLoading, error, refetch };
}

// Get document template by ID
export function useGetDocumentTemplateById(templateId: string) {
  const { getToken } = useAuth();

  const { data: documentTemplate, isLoading, error, refetch } = useQuery({
    queryKey: ['documentTemplate', templateId],
    queryFn: async () => {
      try {
        const token = await getToken();
        if (!token || !templateId) return null;

        const response = await request(
          { path: `/documentTemplates/${templateId}`, method: 'GET' },
          {},
          token
        );

        if (!response.success) {
          console.error('Failed to fetch document template:', response.message);
          return null;
        }

        return response.data;
      } catch (error) {
        console.error('Error fetching document template:', error);
        return null;
      }
    },
    enabled: !!templateId,
  });

  return { documentTemplate, isLoading, error, refetch };
}

// Create document template
export function useCreateDocumentTemplate() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (templateData: Partial<DocumentTemplate>) => {
      const token = await getToken();
      if (!token) throw new Error('No authentication token available');

      const response = await request(
        { path: '/documentTemplates/create', method: 'POST' },
        templateData,
        token
      );

      if (!response.success) {
        throw new Error(response.message || 'Failed to create document template');
      }

      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documentTemplates'] });
    },
  });
}

// Update document template
export function useUpdateDocumentTemplate() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (templateData: Partial<DocumentTemplate> & { id: string }) => {
      const token = await getToken();
      if (!token) throw new Error('No authentication token available');

      const response = await request(
        { path: '/documentTemplates/update', method: 'POST' },
        templateData,
        token
      );

      if (!response.success) {
        throw new Error(response.message || 'Failed to update document template');
      }

      return response.data;
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['documentTemplates'] });
      queryClient.invalidateQueries({ queryKey: ['documentTemplate', variables.id] });
    },
  });
}

// Delete document template
export function useDeleteDocumentTemplate() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (templateId: string) => {
      const token = await getToken();
      if (!token) throw new Error('No authentication token available');

      const response = await request(
        { path: '/documentTemplates/delete', method: 'DELETE' },
        { id: templateId },
        token
      );

      if (!response.success) {
        throw new Error(response.message || 'Failed to delete document template');
      }

      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documentTemplates'] });
    },
  });
}

export const DOCUMENT_TYPES = [
  { label: 'Return Delivery Order', value: 'RDO' },
  { label: 'Delivery Order', value: 'DO' },
  { label: 'Maintenance Service Report', value: 'MSR' },
  { label: 'Quotation', value: 'QO1' },
  { label: 'Invoice', value: 'TI' },
  { label: 'Invoice', value: 'INVOICE' },
  { label: 'Tax Invoice', value: 'TI2' },
];
