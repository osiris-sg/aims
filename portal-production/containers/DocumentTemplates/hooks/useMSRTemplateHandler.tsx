/* eslint-disable @typescript-eslint/no-explicit-any */
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { useDocumentTemplateSlice } from "@/containers/DocumentsTemplateView/slice";
import { useParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { useDispatch, useSelector } from "react-redux";
import { selectDocumentTemplate, selectIsDocumentTemplateUpdating } from "@/containers/DocumentsTemplateView/slice/selectors";
import { useEffect, useMemo } from "react";

export default function useMSRTemplateHandler() {
  const { type } = useParams() as { type?: string };
  const dispatch = useDispatch();
  const { actions } = useDocumentTemplateSlice();
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const isLoading = useSelector(selectIsDocumentTemplateUpdating);
  const documentTemplate = useSelector(selectDocumentTemplate);
  const defaultValues = useMemo(
    () => ({
      name: "Maintenance Service Report",
      type: type,
      reportDetails: {
        equipmentId: true,
        location: true,
        reportType: true,
        date: true,
        description: true,
      },
      photos: true,
    }),
    [type]
  );
  const methods = useForm<any>({
    mode: "onChange",
    defaultValues: defaultValues,
  });

  const {
    handleSubmit,
    watch,
    reset,
    formState: { isDirty, errors },
  } = methods;

  useEffect(() => {
    if (documentTemplate) {
      reset(
        {
          ...documentTemplate,
          ...(documentTemplate?.config ? documentTemplate.config : defaultValues),
        },
        {
          keepDirty: false, // ensure dirty state resets
          keepTouched: false,
          keepValues: false, // optional, depending on what you want
        }
      );
    }
  }, [documentTemplate, reset, defaultValues]);

  const onSubmit = async (data: any) => {
    try {
      const token = await getToken();
      if (token) {
        dispatch(actions.updateDocumentTemplate({ ...data, token, organizationId: organization?.id }));
      }
    } catch (error) {
      console.error("Error submitting form:", error);
    }
  };

  const editableVisibilityFields = useMemo(
    () => [
      {
        title: "Report Details",
        items: [
          { label: "Equipment ID", name: "reportDetails.equipmentId" },
          { label: "Location", name: "reportDetails.location" },
          { label: "Report Type", name: "reportDetails.reportType" },
          { label: "Service Date", name: "reportDetails.date" },
          { label: "Description", name: "reportDetails.description" },
        ],
      },
      {
        title: "Photo Documentation",
        items: [{ label: "Photos", name: "photos" }],
      },
    ],
    []
  );

  return { methods, onSubmit: handleSubmit(onSubmit), editableVisibilityFields, watch, isLoading, isDirty, errors };
}
