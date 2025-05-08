/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useDispatch, useSelector } from "react-redux";

import { selectDocumentTemplates, selectDocumentTemplatesLoading, selectDocumentTemplatesError } from "@/containers/Documents/slice/selectors";
import { useState, useEffect, useCallback } from "react";
import { useOrganization } from "@clerk/nextjs";
import { useAuth } from "@clerk/nextjs";
import { documentTemplateActions } from "@/containers/Documents/slice";
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

  const getTemplateOptions = (status: string) => {
    if (!documentTemplates?.docs) return [];

    if (status === "RENTAL") {
      return documentTemplates.docs.filter((template) => template.type === "RDO");
    }

    if (status === "INSTOCK") {
      return documentTemplates.docs.filter((template) => template.type === "DO");
    }

    return [];
  };
  return { documentTemplates, getTemplateOptions, loading, error, page, limit, search, filters, setPage, setLimit, setSearch, setFilters };
};
