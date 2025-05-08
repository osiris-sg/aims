/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useDispatch, useSelector } from "react-redux";
import { useState, useEffect, useCallback } from "react";
import { useOrganization } from "@clerk/nextjs";
import { useAuth } from "@clerk/nextjs";
import { documentTemplateActions } from "@/containers/Documents/slice";
import { selectCustomers } from "@/containers/Documents/slice/selectors";

export const useGetCustomers = () => {
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const organizationId = organization?.id;
  const dispatch = useDispatch();
  const customers = useSelector(selectCustomers);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(100);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<any>({});

  const getAssets = useCallback(async () => {
    if (organizationId) {
      const token = await getToken();
      dispatch(documentTemplateActions.getCustomers({ page, limit, search, filters, organizationId, token }));
    }
  }, [organizationId]);
  useEffect(() => {
    if (organizationId) {
      getAssets();
    }
  }, [organizationId]);
  return { customers };
};
