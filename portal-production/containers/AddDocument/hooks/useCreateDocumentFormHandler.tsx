/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @typescript-eslint/no-explicit-any */
import * as yup from "yup";
import { yupResolver } from "@hookform/resolvers/yup";
import { useForm } from "react-hook-form";
import { useDispatch, useSelector } from "react-redux";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { documentTemplateActions } from "@/containers/DocumentsTemplateView/slice";
import { selectDocumentTemplateCreationStatus, selectIsDocumentTemplateUpdating } from "@/containers/DocumentsTemplateView/slice/selectors";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/routes";
import { useEffect } from "react";

export default function useCreateDocumentFormHandler() {
  const documentTemplateSchema = yup.object().shape({
    name: yup.string(),
    type: yup.string().required(),
    organizationId: yup.string(),
    assetId: yup.string().nullable(),
  });

  const {
    control,
    handleSubmit,
    watch,
    formState: { isDirty },
  } = useForm({
    mode: "onChange",
    defaultValues: {
      name: "",
      type: "",
      organizationId: "",
      assetId: "",
    },
    resolver: yupResolver(documentTemplateSchema),
  });
  const dispatch = useDispatch();
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const isDocumentTemplateUpdating = useSelector(selectIsDocumentTemplateUpdating);
  const documentCreationStatus = useSelector(selectDocumentTemplateCreationStatus);
  const router = useRouter();

  const typeToNameMap: Record<string, string> = {
    DO: "Delivery Order",
    RDO: "Return Delivery Order",
    TI: "Tax Invoice",
    MSR: "Maintenance Service Report",
    QO1: "Quotation 1", // Add your QO1 template name here
  };

  const onSubmit = async (data: any) => {
    try {
      const token = await getToken();

      dispatch(
        documentTemplateActions.createDocumentTemplate({
          ...data,
          organizationId: organization?.id || "",
          name: typeToNameMap[data.type] || data.name,
          token,
        })
      );
    } catch (error) {
      console.error("Error submitting form:", error);
    }
  };

  useEffect(() => {
    if (documentCreationStatus) {
      router.push(ROUTES.DOCUMENTS);
    }
  }, [documentCreationStatus]);

  return {
    control,
    handleSubmit,
    onSubmit,
    watch,
    isDocumentTemplateUpdating,
    isDirty,
  };
}
