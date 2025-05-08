/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useDispatch, useSelector } from "react-redux";
import { inventoryActions } from "../slice";
import { selectInventories, selectInventoriesLoading, selectInventoriesError, selectFilters, selectCategories } from "../slice/selectors";
import { useState, useEffect, useCallback } from "react";
import { useOrganization } from "@clerk/nextjs";
import { useAuth } from "@clerk/nextjs";
import { Filters } from "../slice/types";
export const useGetInventories = () => {
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const organizationId = organization?.id;
  const dispatch = useDispatch();
  const inventories = useSelector(selectInventories);
  const loading = useSelector(selectInventoriesLoading);
  const error = useSelector(selectInventoriesError);
  const filters = useSelector(selectFilters);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [search, setSearch] = useState("");

  const serializeDate = (date: Date) => {
    return JSON.parse(JSON.stringify(date));
  };
  const categories = useSelector(selectCategories);
  const setFilters = (filters: Filters) => {
    const category = categories.find((category) => category.id === filters.category);

    const newFilters = {
      ...filters,
      createdOn: {
        startDate: serializeDate(filters.createdOn.startDate as Date),
        endDate: serializeDate(filters.createdOn.endDate as Date),
      },
      category: category ? category.name : "",
    };

    dispatch(inventoryActions.updateFilters(newFilters));
  };

  const getInventories = useCallback(async () => {
    if (organizationId) {
      const token = await getToken();
      if (token) {
        dispatch(inventoryActions.getInventories({ page, limit, search, filters, organizationId, token }));
      }
    }
  }, [page, limit, search, filters, organizationId]);
  useEffect(() => {
    if (organizationId) {
      getInventories();
    }
  }, [page, limit, search, filters, organizationId]);
  return { inventories, loading, error, page, limit, search, filters, setPage, setLimit, setSearch, setFilters };
};
