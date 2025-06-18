/* eslint-disable @typescript-eslint/no-explicit-any */
import { useAuth, useOrganization } from "@clerk/nextjs";
import { useDocumentTemplateSlice } from "@/containers/DocumentsTemplateView/slice";
import { useParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { useDispatch, useSelector } from "react-redux";
import { selectDocumentTemplate, selectIsDocumentTemplateUpdating } from "@/containers/DocumentsTemplateView/slice/selectors";
import { useEffect } from "react";

export default function useTITemplateHandler() {
  const { type } = useParams() as { type?: string };
  const dispatch = useDispatch();
  const { actions } = useDocumentTemplateSlice();
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const isLoading = useSelector(selectIsDocumentTemplateUpdating);
  const documentTemplate = useSelector(selectDocumentTemplate);
  const defaultValues = {
    name: "Delivery Order",
    logo: true,
    type: type,
    company: { name: true, address: true, phoneNumber: true },
    customer: true,
    attention: { name: true, phoneNumber: true },
    deliveryTo: true,
    doNo: true,
    referenceNo: true,
    poNo: true,
  };
  const methods = useForm<any>({
    mode: "onChange",
    defaultValues: defaultValues,
  });

  const {
    handleSubmit,
    watch,
    reset,
    formState: { isDirty },
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
  }, [documentTemplate, reset]);

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

  const editableVisibilityFields = [
    {
      title: "Company fields",
      items: [
        { label: "Logo", name: "logo" },
        { label: "Company name", name: "company.name" },
        { label: "Adress", name: "company.address" },
      ],
    },
    {
      title: "Document Fields",
      items: [
        { label: "DO No.", name: "doNo" },
        { label: "Ref No.", name: "referenceNo" },
        { label: "PO No.", name: "poNo" },
        { label: "Customer", name: "customer" },
        { label: "Mobile", name: "attention.phoneNumber" },
        { label: "Delivery To", name: "deliveryTo" },
      ],
    },
  ];

  return { methods, onSubmit: handleSubmit(onSubmit), editableVisibilityFields, watch, isLoading, isDirty };
}
