/* eslint-disable @typescript-eslint/no-explicit-any */
import { assetsActions } from "@/containers/Assets/slice";
import { selectAsset, selectCategories, selectIsGetAssetLoading } from "@/containers/Assets/slice/selectors";
import { useAuth, useOrganization } from "@clerk/nextjs";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";

export default function useGetAsset() {
  const params = useParams();
  const skuKey = params.skuKey;
  const asset = useSelector(selectAsset);
  const isGetAssetLoading = useSelector(selectIsGetAssetLoading);
  const categories = useSelector(selectCategories);
  const dispatch = useDispatch();
  const { getToken } = useAuth();
  const [category, setCategory] = useState<any>();
  const { organization } = useOrganization();
  const organizationId = organization?.id;

  const getAsset = useCallback(async () => {
    const token = await getToken();
    if (token && skuKey) {
      dispatch(assetsActions.getAssetbySKUKEY({ skuKey: skuKey as string, token }));
    }
  }, [dispatch, getToken, skuKey]);
  useEffect(() => {
    getAsset();
  }, [getAsset]);

  const getCategories = useCallback(async () => {
    if (organizationId) {
      const token = await getToken();
      dispatch(assetsActions.getCategories({ organizationId, token }));
    }
  }, [organizationId, dispatch, getToken]);
  useEffect(() => {
    if (organizationId) {
      getCategories();
    }
  }, [organizationId, getCategories]);

  useEffect(() => {
    if (asset) {
      const category = categories.find((item) => item.id === asset?.categoryId);
      setCategory(category);
    }
  }, [asset]);
  return { asset, category, isGetAssetLoading };
}
