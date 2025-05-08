/* eslint-disable @typescript-eslint/no-explicit-any */
import { useGetAssets } from "@/containers/Inventory/hooks/useGetAssets";
import { inventoryActions } from "@/containers/Inventory/slice";
import { selectDocuments, selectInventory, selectIsGetInventoryLoading, selectIsGetTimelineItemsLoading, selectTimelineItems } from "@/containers/Inventory/slice/selectors";
import { useAuth } from "@clerk/nextjs";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";

export default function useGetInventory() {
  const params = useParams();
  const sku = params.sku;
  const dispatch = useDispatch();
  const { getToken } = useAuth();
  const inventory = useSelector(selectInventory);
  const documents = useSelector(selectDocuments);
  const timelineItems = useSelector(selectTimelineItems);
  const isGetInventoryLoading = useSelector(selectIsGetInventoryLoading);
  const isGetTimelineItemsLoading = useSelector(selectIsGetTimelineItemsLoading);
  const { assets } = useGetAssets();
  const [asset, setAsset] = useState<any>();
  const [token, setToken] = useState<string | null>(null);

  const getInventory = useCallback(async () => {
    const t = await getToken();
    if (t && sku) {
      setToken(t);
      dispatch(inventoryActions.getInventorybySku({ sku: sku as string, token: t }));
    }
  }, [dispatch, getToken, sku]);

  useEffect(() => {
    getInventory();
  }, [getInventory]);

  useEffect(() => {
    if (inventory && token) {
      const asset = assets.docs.find((asset) => asset.id === inventory.assetId);
      setAsset(asset);
      dispatch(inventoryActions.getDocumentsByInventoryId({ inventoryId: inventory.id, token }));
      dispatch(inventoryActions.getTimelineItemsByInventoryId({ inventoryId: inventory.id, token }));
    }
  }, [assets, inventory, token]);
  return { inventory, asset, isGetInventoryLoading, documents, timelineItems, isGetTimelineItemsLoading };
}
