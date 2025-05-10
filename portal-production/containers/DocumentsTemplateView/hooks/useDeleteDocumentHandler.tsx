import { useDispatch, useSelector } from "react-redux";
import { documentTemplateActions } from "../slice";
import { selectDeleteingDocumentTemplateId, selectIsDocumentTemplateDeleteInProgress } from "../slice/selectors";
import { useAuth } from "@clerk/nextjs";
export default function useDeleteDocumentHandler() {
  const dispatch = useDispatch();
  const { getToken } = useAuth();
  const setDocumentToDelete = (id: string | null) => {
    dispatch(documentTemplateActions.setDocumentTemplateToDelete(id));
  };
  const documentToDelete = useSelector(selectDeleteingDocumentTemplateId);
  const isDeleteInProgress = useSelector(selectIsDocumentTemplateDeleteInProgress);
  const onDeleteConfirm = async () => {
    const token = await getToken();
    if (token && documentToDelete) {
      dispatch(documentTemplateActions.deleteDocumentTemplate({ id: documentToDelete, token }));
    }
  };
  return {
    setDocumentToDelete,
    documentToDelete,
    isDeleteInProgress,
    onDeleteConfirm,
  };
}
