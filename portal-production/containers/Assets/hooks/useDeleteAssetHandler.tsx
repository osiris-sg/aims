import { useDispatch, useSelector } from "react-redux";
import { assetsActions } from "../slice";
import { selectDeleteingAssetId, selectIsDeleteInProgress, selectAssetsError, selectIsAssetDeletionSucceeded } from "../slice/selectors";
import { useAuth } from "@clerk/nextjs";
import { useEffect } from "react";
import { notificationsActions } from "../../Notifications/slice";
export default function useDeleteAssetHandler() {
  const dispatch = useDispatch();
  const deleteError = useSelector(selectAssetsError);
  useEffect(() => {
    if (deleteError) {
      dispatch(
        notificationsActions.setNotification({
          message: deleteError,
          type: "error",
        })
      );
    }
  }, [deleteError, dispatch]);
  const isDeleteSucceeded = useSelector(selectIsAssetDeletionSucceeded);

  useEffect(() => {
    if (deleteError) {
      dispatch(
        notificationsActions.setNotification({
          message: deleteError,
          type: "error",
        })
      );
      dispatch(assetsActions.resetDeleteError()); // ✅ clear error after showing
    }
  }, [deleteError, dispatch]);
  const { getToken } = useAuth();
  const setAssetToDelete = (id: string | null) => {
    dispatch(assetsActions.setAssetToDelete(id));
  };
  const assetToDelete = useSelector(selectDeleteingAssetId);
  const isDeleteInProgress = useSelector(selectIsDeleteInProgress);
  const onDeleteConfirm = async () => {
    const token = await getToken();
    if (token && assetToDelete) {
      try {
        dispatch(assetsActions.deleteAsset({ id: assetToDelete, token }));
      } catch (error: unknown) {
        console.error("Delete failed:", error);
      }
    }
  };
  return {
    setAssetToDelete,
    assetToDelete,
    isDeleteInProgress,
    onDeleteConfirm,
  };
}
