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
    if (!organizationId) return;
    setLoading(true);
    try {
      console.log("Fetching document templates for organization:", organizationId);
      setLoading(true);
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
  }, [page, limit, search, filters]);

  useEffect(() => {
    getDocumentTemplates();
  }, [getDocumentTemplates, page, limit, search, filters, organizationId]);

  const documentTypes = useMemo(() => {
    if (!documentTemplates || documentTemplates.docs.length === 0) return [];
    return Array.from(new Set(documentTemplates.docs.map((doc: any) => doc.type)));
  }, [documentTemplates]);

  const availableDocumentTypes = DOCUMENT_TYPES;

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
