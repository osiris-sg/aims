/* eslint-disable @typescript-eslint/no-explicit-any */
import { documentTemplateActions } from "@/containers/DocumentsTemplateView/slice";
import { selectDocument, selectDocumentTemplate, selectDocumentTemplatesError, selectDocumentTemplatesLoading, selectIsGetDocumentTemplateLoading } from "@/containers/DocumentsTemplateView/slice/selectors";
import { useAuth, useOrganization } from "@clerk/nextjs";
import { useParams } from "next/navigation";
import { useCallback, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";

export default function useGetDocument() {
  const dispatch = useDispatch();
  const documentTemplate = useSelector(selectDocumentTemplate);
  const document = useSelector(selectDocument);
  const loading = useSelector(selectDocumentTemplatesLoading);
  const error = useSelector(selectDocumentTemplatesError);
  const { getToken } = useAuth();
  const params = useParams();
  const id: any = params?.id;
  const documentId: any = params?.documentId;
  const isEditMode = Boolean(id);
  const { organization } = useOrganization();
  const organizationId = organization?.id;

  const getDocumentTemplate = useCallback(async () => {
    const token = await getToken();
    if (!token || !organizationId) return;

    if (id) {
      dispatch(documentTemplateActions.getDocumentTemplatebyId({ id, token }));
    }

    if (documentId) {
      dispatch(documentTemplateActions.getDocumentbyId({ id: documentId, token }));
    }
  }, [id, documentId, dispatch, getToken, organizationId]);

  useEffect(() => {
    getDocumentTemplate();
  }, [getDocumentTemplate]);

  const isDocumentLoading = useSelector(selectIsGetDocumentTemplateLoading);

  return {
    documentTemplate,
    document,
    loading,
    error,
    isEditMode,
    isDocumentLoading,
  };
}
