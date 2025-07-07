/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useDispatch, useSelector } from "react-redux";
import { documentTemplateActions } from "../slice";
import { selectDocumentTemplates, selectDocumentTemplatesLoading, selectDocumentTemplatesError } from "../slice/selectors";
import { useState, useEffect, useCallback } from "react";
import { useOrganization } from "@hooks/useOrganization";
import { useAuth } from "@clerk/nextjs";
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
  return { documentTemplates, loading, error, page, limit, search, filters, setPage, setLimit, setSearch, setFilters };
};
