import { assetsActions } from "@/containers/Assets/slice";
import { selectAsset, selectIsGetInventoriesLoading, selectStatusCounts } from "@/containers/Assets/slice/selectors";
import { useAuth, useOrganization } from "@clerk/nextjs";
import { useCallback, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";

export default function useStatusCountsHandler() {
  const asset = useSelector(selectAsset);
  const inventoriesStatusCounts = useSelector(selectStatusCounts);
  const isGetInventoriesLoading = useSelector(selectIsGetInventoriesLoading);
  const { organization } = useOrganization();
  const organizationId = organization?.id;
  const dispatch = useDispatch();
  const { getToken } = useAuth();

  const getInventoriesByAsset = useCallback(async () => {
    const token = await getToken();
    if (token && organizationId && asset) {
      dispatch(assetsActions.getInventoriesByAsset({ asset: asset.id, organizationId, token }));
    }
  }, [dispatch, getToken, organizationId, asset]);

  useEffect(() => {
    getInventoriesByAsset();
  }, [getInventoriesByAsset]);
  return { inventoriesStatusCounts, isGetInventoriesLoading };
}
