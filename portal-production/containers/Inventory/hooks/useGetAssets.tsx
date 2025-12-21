/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useDispatch, useSelector } from "react-redux";
import { useState, useEffect, useCallback } from "react";
import { useOrganization } from "@hooks/useOrganization";
import { useAuth } from "@clerk/nextjs";

import { inventoryActions } from "../slice";
import { selectAssets, selectCategories } from "../slice/selectors";

export const useGetAssets = () => {
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const organizationId = organization?.id;
  const dispatch = useDispatch();
  const assets = useSelector(selectAssets);
  const categories = useSelector(selectCategories);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(100);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<any>({
    // Only show tracked assets for inventory creation
    // Untracked products cannot have individual inventory items
    isTracked: true,
  });

  const getAssets = useCallback(async () => {
    if (organizationId) {
      const token = await getToken();
      dispatch(inventoryActions.getAssets({ page, limit, search, filters: { ...filters, isTracked: true }, organizationId, token }));
      dispatch(inventoryActions.getCategories({ organizationId, token }));
    }
  }, [organizationId]);
  useEffect(() => {
    if (organizationId) {
      getAssets();
    }
  }, [organizationId]);
  return { assets, categories };
};
