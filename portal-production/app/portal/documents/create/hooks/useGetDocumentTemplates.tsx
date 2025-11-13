/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import { DOCUMENT_TYPES } from "@/containers/DocumentsTemplateView/slice/constants";

export const useGetDocumentTemplates = () => {
  const { getToken } = useAuth();

  const [documentTemplates, setDocumentTemplates] = useState<{ docs: any[] }>({ docs: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<any>({});
  const { organization } = useOrganization();
  const organizationId = organization?.id;

  const getDocumentTemplates = useCallback(async () => {
    if (!organizationId) {
      return;
    }
    setLoading(true);
    try {
      const token = await getToken();
      const response = await request(
        {
          path: "/documentTemplates",
          method: "POST",
        },
        {
          page,
          limit,
          search,
          filters,
          organizationId,
        },
        token ?? undefined
      );
      setDocumentTemplates(response.data);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Error fetching document templates";
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [page, limit, search, filters, organizationId, getToken]);

  useEffect(() => {
    getDocumentTemplates();
  }, [getDocumentTemplates, page, limit, search, filters, organizationId]);

  // Use actual template names from the database
  const availableDocumentTypes = useMemo(() => {
    if (!documentTemplates.docs || documentTemplates.docs.length === 0) {
      // Fallback to default types while templates are loading
      // Filter out INVOICE from default types as well
      return DOCUMENT_TYPES.filter((type: any) => type.value !== 'INVOICE');
    }

    // Filter out INVOICE templates and map to the format expected by the dropdown
    return documentTemplates.docs
      .filter((template) => template.type !== 'INVOICE') // Exclude INVOICE type templates
      .map((template) => ({
        label: template.name || template.type, // Use template name or fallback to type
        value: template.type, // Keep the type as value for API calls
        templateId: template.id, // Store template ID for reference
      }));
  }, [documentTemplates.docs]);

  return {
    documentTemplates,
    loading,
    error,
    page,
    limit,
    search,
    filters,
    setPage,
    setLimit,
    setSearch,
    setFilters,
    availableDocumentTypes,
  };
};
