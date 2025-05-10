import { useDispatch, useSelector } from "react-redux";
import { documentActions } from "../slice";
import { selectDeletingDocumentId, selectIsDocumentDeleteInProgress } from "../slice/selectors";
import { useAuth } from "@clerk/nextjs";
export default function useDeleteDocumentHandler() {
  const dispatch = useDispatch();
  const { getToken } = useAuth();
  const setDocumentToDelete = (id: string | null) => {
    dispatch(documentActions.setDocumentToDelete(id));
  };
  const documentToDelete = useSelector(selectDeletingDocumentId);
  const isDeleteInProgress = useSelector(selectIsDocumentDeleteInProgress);
  const onDeleteConfirm = async () => {
    const token = await getToken();
    if (token && documentToDelete) {
      dispatch(documentActions.deleteDocument({ id: documentToDelete, token }));
    }
  };
  return {
    setDocumentToDelete,
    documentToDelete,
    isDeleteInProgress,
    onDeleteConfirm,
  };
}
