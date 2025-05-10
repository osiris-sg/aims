/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useDispatch, useSelector } from "react-redux";
import { selectDocumentTemplates, selectDocumentTemplatesLoading, selectDocumentTemplatesError } from "@/containers/DocumentsTemplateView/slice/selectors";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useOrganization } from "@clerk/nextjs";
import { useAuth } from "@clerk/nextjs";
import { documentTemplateActions } from "@/containers/DocumentsTemplateView/slice";
import { DOCUMENT_TYPES } from "@/containers/DocumentsTemplateView/slice/constants";
export const useGetDocuments = () => {
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const organizationId = organization?.id;
  const dispatch = useDispatch();
  const documentTemplates = useSelector(selectDocumentTemplates);
  const loading = useSelector(selectDocumentTemplatesLoading);
  const error = useSelector(selectDocumentTemplatesError);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<any>({});

  const getDocumentTemplates = useCallback(async () => {
    if (organizationId) {
      const token = await getToken();
      dispatch(documentTemplateActions.getDocumentTemplates({ page, limit, search, filters, organizationId, token }));
    }
  }, [page, limit, search, filters, organizationId]);
  useEffect(() => {
    if (organizationId) {
      getDocumentTemplates();
    }
  }, [page, limit, search, filters, organizationId]);

  const documentTypes = useMemo(() => {
    if (!documentTemplates || documentTemplates.docs.length === 0) return [];
    return Array.from(new Set(documentTemplates.docs.map((doc: any) => doc.type)));
  }, [documentTemplates]);

  const availableDocumentTypes = DOCUMENT_TYPES.filter((doc) => doc.value === "MSR" || !documentTypes.includes(doc.value));

  return { documentTemplates, loading, error, page, limit, search, filters, setPage, setLimit, setSearch, setFilters, availableDocumentTypes };
};
