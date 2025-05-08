/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useDispatch, useSelector } from "react-redux";
import { customerActions } from "../slice";
import { selectCustomers, selectCustomersLoading, selectCustomersError, selectFilters } from "../slice/selectors";
import { useState, useEffect, useCallback } from "react";
import { useOrganization } from "@clerk/nextjs";
import { useAuth } from "@clerk/nextjs";
import { Filters } from "../slice/types";
export const useGetCustomers = () => {
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const organizationId = organization?.id;
  const dispatch = useDispatch();
  const customers = useSelector(selectCustomers);
  const loading = useSelector(selectCustomersLoading);
  const error = useSelector(selectCustomersError);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [search, setSearch] = useState("");
  const filters = useSelector(selectFilters);

  const serializeDate = (date: Date) => {
    return JSON.parse(JSON.stringify(date));
  };

  const setFilters = (filters: Filters) => {
    const newFilters = { ...filters, createdOn: { startDate: serializeDate(filters.createdOn.startDate as Date), endDate: serializeDate(filters.createdOn.endDate as Date) } };
    dispatch(customerActions.updateFilters(newFilters));
  };

  const getCustomers = useCallback(async () => {
    if (organizationId) {
      const token = await getToken();
      if (token) {
        dispatch(customerActions.getCustomers({ page, limit, search, filters, organizationId, token }));
      }
    }
  }, [page, limit, search, filters, organizationId]);
  useEffect(() => {
    if (organizationId) {
      getCustomers();
    }
  }, [page, limit, search, filters, organizationId]);
  return { customers, loading, error, page, limit, search, filters, setPage, setLimit, setSearch, setFilters };
};
