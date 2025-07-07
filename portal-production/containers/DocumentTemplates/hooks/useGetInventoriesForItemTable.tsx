/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useDispatch, useSelector } from "react-redux";
import { useEffect, useCallback, useMemo } from "react";
import { useOrganization } from "@hooks/useOrganization";
import { useAuth } from "@clerk/nextjs";
import { documentTemplateActions } from "@/containers/DocumentsTemplateView/slice";
import { selectDocument, selectDocumentTemplatesError, selectDocumentTemplatesLoading, selectInventoriesForDocument } from "@/containers/DocumentsTemplateView/slice/selectors";
import { useParams } from "next/navigation";

export const useGetInventoriesForItemTable = () => {
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const organizationId = organization?.id;
  const dispatch = useDispatch();
  const inventoriesForDocument = useSelector(selectInventoriesForDocument);
  const loading = useSelector(selectDocumentTemplatesLoading);
  const error = useSelector(selectDocumentTemplatesError);
  const document = useSelector(selectDocument);
  const { type } = useParams() as { type?: string };

  const inventoryIds = useMemo(() => {
    return document?.config?.items?.map((item: any) => item.inventoryItemId).filter(Boolean);
  }, [document]);

  const fetchInventoriesByStatus = useCallback(
    async (status: string) => {
      if (!organizationId) return;
      const token = await getToken();
      if (!token) return;

      dispatch(documentTemplateActions.getDocumentInventories({ status, token }));
    },
    [organizationId]
  );

  const fetchInventoriesByIds = useCallback(async () => {
    if (!inventoryIds?.length) return;
    const token = await getToken();
    if (!token) return;
    dispatch(documentTemplateActions.getInventoriesByIds({ token, inventoryIds }));
  }, [inventoryIds]);

  useEffect(() => {
    if (!organizationId) return;

    if (type === "RDO") {
      fetchInventoriesByStatus("rental");
    } else if (type === "DO") {
      fetchInventoriesByStatus("instock");
    }
  }, [organizationId, type, fetchInventoriesByStatus, fetchInventoriesByIds]);

  return { inventoriesForDocument, loading, error };
};
