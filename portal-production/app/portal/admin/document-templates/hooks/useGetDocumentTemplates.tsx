"use client";

import { useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";
import { useEffect, useState, useCallback } from "react";

interface DocumentTemplate {
  id: string;
  name: string;
  type: string;
  templateVariant: string;
  designName: string;
  description: string;
  isActive: boolean;
  isDefault: boolean;
  organizationId: string;
  organization?: {
    id: string;
    name: string;
  };
  config: any;
  createdAt: string;
  updatedAt: string;
}

interface PaginatedResponse {
  docs: DocumentTemplate[];
  totalDocuments: number;
  totalPagesCount: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  page: number;
  limit: number;
}

export function useGetDocumentTemplates() {
  const { getToken } = useAuth();
  const [templates, setTemplates] = useState<PaginatedResponse>({
    docs: [],
    totalDocuments: 0,
    totalPagesCount: 0,
    hasNextPage: false,
    hasPreviousPage: false,
    page: 1,
    limit: 10,
  });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});

  const fetchTemplates = useCallback(async () => {
    try {
      setLoading(true);
      const token = await getToken();
      if (!token) return;

      const response = await request(
        {
          path: `/documentTemplates`,
          method: "POST",
        },
        {
          page,
          limit,
          search,
          ...filters,
        },
        token
      );

      if (response.success) {
        setTemplates(response.data);
      }
    } catch (error) {
      console.error("Error fetching document templates:", error);
    } finally {
      setLoading(false);
    }
  }, [getToken, page, limit, search, filters]);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const refetch = () => {
    fetchTemplates();
  };

  return {
    templates,
    loading,
    page,
    limit,
    search,
    filters,
    setPage,
    setLimit,
    setSearch,
    setFilters,
    refetch,
  };
}

export function useGetDocumentTemplate(id: string) {
  const { getToken } = useAuth();
  const [template, setTemplate] = useState<DocumentTemplate | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchTemplate = useCallback(async () => {
    if (!id) return;

    try {
      setLoading(true);
      const token = await getToken();
      if (!token) return;

      const response = await request(
        {
          path: `/documentTemplates/${id}`,
          method: "GET",
        },
        {},
        token
      );

      if (response.success) {
        setTemplate(response.data);
      }
    } catch (error) {
      console.error("Error fetching document template:", error);
    } finally {
      setLoading(false);
    }
  }, [getToken, id]);

  useEffect(() => {
    fetchTemplate();
  }, [fetchTemplate]);

  const refetch = () => {
    fetchTemplate();
  };

  return {
    template,
    loading,
    refetch,
  };
}

export function useGetTemplateFieldDefinitions(templateId: string) {
  const { getToken } = useAuth();
  const [fieldDefinitions, setFieldDefinitions] = useState<any>(null);
  const [source, setSource] = useState<string>("default");
  const [loading, setLoading] = useState(true);

  const fetchFieldDefinitions = useCallback(async () => {
    if (!templateId) return;

    try {
      setLoading(true);
      const token = await getToken();
      if (!token) return;

      const response = await request(
        {
          path: `/documentTemplates/${templateId}/fields`,
          method: "GET",
        },
        {},
        token
      );

      if (response.success) {
        setFieldDefinitions(response.data.formFields);
        setSource(response.data.source);
      }
    } catch (error) {
      console.error("Error fetching field definitions:", error);
    } finally {
      setLoading(false);
    }
  }, [getToken, templateId]);

  useEffect(() => {
    fetchFieldDefinitions();
  }, [fetchFieldDefinitions]);

  const refetch = () => {
    fetchFieldDefinitions();
  };

  return {
    fieldDefinitions,
    source,
    loading,
    refetch,
  };
}

export function useUpdateTemplateFieldDefinitions() {
  const { getToken } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateFieldDefinitions = async (templateId: string, formFields: any) => {
    try {
      setLoading(true);
      setError(null);
      const token = await getToken();
      if (!token) throw new Error("No token");

      const response = await request(
        {
          path: `/documentTemplates/${templateId}/fields`,
          method: "PUT",
        },
        { formFields },
        token
      );

      if (!response.success) {
        throw new Error(response.message || "Failed to update field definitions");
      }

      return response.data;
    } catch (error: any) {
      setError(error.message);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  return {
    updateFieldDefinitions,
    loading,
    error,
  };
}

export function usePopulateTemplateFields() {
  const { getToken } = useAuth();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const populateFields = async () => {
    try {
      setLoading(true);
      const token = await getToken();
      if (!token) throw new Error("No token");

      const response = await request(
        {
          path: `/documentTemplates/populate-fields`,
          method: "POST",
        },
        {},
        token
      );

      if (response.success) {
        setResult(response.data);
      }
      return response.data;
    } catch (error) {
      console.error("Error populating template fields:", error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  return {
    populateFields,
    loading,
    result,
  };
}
