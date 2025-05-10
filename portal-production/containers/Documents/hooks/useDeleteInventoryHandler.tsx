import { useDispatch, useSelector } from "react-redux";
import { inventoryActions } from "../slice";
import { selectDeleteingInventoryId, selectIsInventoryDeleteInProgress, selectIsInventoryDeletionSucceeded } from "../slice/selectors";
import { useAuth } from "@clerk/nextjs";
import { useEffect } from "react";
import { notificationsActions } from "../../Notifications/slice";

export default function useDeleteInventoryHandler() {
  const dispatch = useDispatch();
  const { getToken } = useAuth();
  const setInventoryToDelete = (id: string | null) => {
    dispatch(inventoryActions.setInventoryToDelete(id));
  };
  const inventoryToDelete = useSelector(selectDeleteingInventoryId);
  const isDeleteInProgress = useSelector(selectIsInventoryDeleteInProgress);
  const isDeleteSucceeded = useSelector(selectIsInventoryDeletionSucceeded);

  useEffect(() => {
    if (isDeleteSucceeded) {
      dispatch(
        notificationsActions.setNotification({
          message: "Inventory item deleted successfully.",
          type: "success",
        })
      );
      dispatch(inventoryActions.resetDeletionSuccess());
    }
  }, [isDeleteSucceeded, dispatch]);

  const onDeleteConfirm = async () => {
    const token = await getToken();
    if (token && inventoryToDelete) {
      dispatch(inventoryActions.deleteInventory({ id: inventoryToDelete, token }));
    }
  };
  return {
    setInventoryToDelete,
    inventoryToDelete,
    isDeleteInProgress,
    onDeleteConfirm,
  };
}
