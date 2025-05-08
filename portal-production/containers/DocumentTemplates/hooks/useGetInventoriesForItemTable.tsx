/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useDispatch, useSelector } from "react-redux";
import { useEffect, useCallback, useMemo } from "react";
import { useOrganization } from "@clerk/nextjs";
import { useAuth } from "@clerk/nextjs";
import { documentTemplateActions } from "@/containers/Documents/slice";
import { selectDocument, selectDocumentTemplatesError, selectDocumentTemplatesLoading, selectInventoriesForDocument } from "@/containers/Documents/slice/selectors";
import { useParams } from "next/navigation";

export const useGetInventoriesForItemTable = () => {
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const organizationId = organization?.id;
  const dispatch = useDispatch();
  const inventoriesForDocument = useSelector(selectInventoriesForDocument);
  const loading = useSelector(selectDocumentTemplatesLoading);
  const error = useSelector(selectDocumentTemplatesError);
  const { documentId } = useParams();
  const isReadOnly = Boolean(documentId);
  const document = useSelector(selectDocument);
  const { type } = useParams() as { type?: string };

  const inventoryIds = useMemo(() => {
    if (!isReadOnly) return undefined;
    return document?.config?.items?.map((item: any) => item.inventoryItemId).filter(Boolean);
  }, [document, isReadOnly]);

  const fetchInventoriesByStatus = useCallback(
    async (status: string) => {
      if (!organizationId) return;
      const token = await getToken();
      if (!token) return;

      dispatch(documentTemplateActions.getDocumentInventories({ organizationId, status, token }));
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
    if (isReadOnly) {
      fetchInventoriesByIds();
    } else {
      if (type === "RDO") {
        fetchInventoriesByStatus("RENTAL");
      } else if (type === "DO") {
        fetchInventoriesByStatus("INSTOCK");
      }
    }
  }, [organizationId, isReadOnly, type, fetchInventoriesByStatus, fetchInventoriesByIds]);

  return { inventoriesForDocument, loading, error };
};
