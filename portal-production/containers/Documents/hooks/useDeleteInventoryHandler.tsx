import { useDispatch, useSelector } from "react-redux";
import { inventoryActions } from "../slice";
import { selectDeleteingInventoryId, selectIsInventoryDeleteInProgress } from "../slice/selectors";
import { useAuth } from "@clerk/nextjs";
export default function useDeleteDocumentHandler() {
  const dispatch = useDispatch();
  const { getToken } = useAuth();
  const setDocumentToDelete = (id: string | null) => {
    dispatch(inventoryActions.setInventoryToDelete(id));
  };
  const documentToDelete = useSelector(selectDeleteingInventoryId);
  const isDeleteInProgress = useSelector(selectIsInventoryDeleteInProgress);
  const onDeleteConfirm = async () => {
    const token = await getToken();
    if (token && documentToDelete) {
      dispatch(inventoryActions.deleteInventory({ id: documentToDelete, token }));
    }
  };
  return {
    setDocumentToDelete,
    documentToDelete,
    isDeleteInProgress,
    onDeleteConfirm,
  };
}
