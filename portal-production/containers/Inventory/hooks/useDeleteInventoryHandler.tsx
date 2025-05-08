import { useDispatch, useSelector } from "react-redux";
import { inventoryActions } from "../slice";
import { selectDeleteingInventoryId, selectIsInventoryDeleteInProgress } from "../slice/selectors";
import { useAuth } from "@clerk/nextjs";
export default function useDeleteInventoryHandler() {
  const dispatch = useDispatch();
  const { getToken } = useAuth();
  const setInventoryToDelete = (id: string | null) => {
    dispatch(inventoryActions.setInventoryToDelete(id));
  };
  const inventoryToDelete = useSelector(selectDeleteingInventoryId);
  const isDeleteInProgress = useSelector(selectIsInventoryDeleteInProgress);
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
