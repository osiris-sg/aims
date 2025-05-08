import { useDispatch, useSelector } from "react-redux";
import { assetsActions } from "../slice";
import { selectDeleteingAssetId, selectIsDeleteInProgress } from "../slice/selectors";
import { useAuth } from "@clerk/nextjs";
export default function useDeleteAssetHandler() {
  const dispatch = useDispatch();
  const { getToken } = useAuth();
  const setAssetToDelete = (id: string | null) => {
    dispatch(assetsActions.setAssetToDelete(id));
  };
  const assetToDelete = useSelector(selectDeleteingAssetId);
  const isDeleteInProgress = useSelector(selectIsDeleteInProgress);
  const onDeleteConfirm = async () => {
    const token = await getToken();
    if (token && assetToDelete) {
      dispatch(assetsActions.deleteAsset({ id: assetToDelete, token }));
    }
  };
  return {
    setAssetToDelete,
    assetToDelete,
    isDeleteInProgress,
    onDeleteConfirm,
  };
}
