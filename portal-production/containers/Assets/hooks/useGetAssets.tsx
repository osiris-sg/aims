/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useDispatch, useSelector } from "react-redux";
import { assetsActions } from "../slice";
import { selectAssets, selectAssetsLoading, selectAssetsError, selectFilters } from "../slice/selectors";
import { useState, useEffect, useCallback } from "react";
import { useOrganization } from "@hooks/useOrganization";
import { useAuth } from "@clerk/nextjs";
import { Filters } from "../slice/types";

export const useGetAssets = () => {
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const organizationId = organization?.id;
  const dispatch = useDispatch();
  const assets = useSelector(selectAssets);
  const loading = useSelector(selectAssetsLoading);
  const error = useSelector(selectAssetsError);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [search, setSearch] = useState("");
  const filters = useSelector(selectFilters);

  const setFilters = (filters: Filters) => {
    dispatch(assetsActions.updateFilters(filters));
  };

  const getAssets = useCallback(async () => {
    if (organizationId) {
      const token = await getToken();
      dispatch(assetsActions.getAssets({ page, limit, search, filters, organizationId, token }));
    }
  }, [page, limit, search, filters, organizationId]);
  useEffect(() => {
    if (organizationId) {
      getAssets();
    }
  }, [page, limit, search, filters, organizationId]);
  return { assets, loading, error, page, limit, search, filters, setPage, setLimit, setSearch, setFilters };
};
