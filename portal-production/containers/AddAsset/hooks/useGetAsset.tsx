import { assetsActions } from "@/containers/Assets/slice";
import { selectAsset, selectAssetsError, selectAssetsLoading } from "@/containers/Assets/slice/selectors";
import { useAuth, useOrganization } from "@clerk/nextjs";
import { useParams } from "next/navigation";
import { useCallback, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";

export default function useGetAsset() {
  const dispatch = useDispatch();
  const asset = useSelector(selectAsset);
  const loading = useSelector(selectAssetsLoading);
  const error = useSelector(selectAssetsError);
  const { getToken } = useAuth();
  const params = useParams();
  const id = typeof params?.id === "string" ? params.id : "";
  const isEditMode = Boolean(id);
  const { organization } = useOrganization();
  const organizationId = organization?.id;

  const getAsset = useCallback(async () => {
    const token = await getToken();
    if (id && token && organizationId) {
      dispatch(assetsActions.getAssetbyId({ id, token }));
    }
  }, [id, dispatch, getToken, organizationId]);

  useEffect(() => {
    getAsset();
  }, [getAsset]);

  return { asset, loading, error, isEditMode };
}
