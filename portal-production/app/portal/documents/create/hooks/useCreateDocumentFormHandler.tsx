/* eslint-disable @typescript-eslint/no-explicit-any */
import * as yup from "yup";
import { yupResolver } from "@hookform/resolvers/yup";
import { useForm } from "react-hook-form";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/routes";
import { useState } from "react";
import { request } from "@/helpers/request";

export default function useCreateDocumentFormHandler() {
  const documentTemplateSchema = yup.object().shape({
    type: yup.string().required(),
  });

  const {
    control,
    handleSubmit,
    watch,
    formState: { isDirty },
  } = useForm({
    mode: "onChange",
    defaultValues: {
      type: "",
    },
    resolver: yupResolver(documentTemplateSchema),
  });

  const { getToken } = useAuth();
  const router = useRouter();
  const [isDocumentTemplateUpdating, setIsDocumentTemplateUpdating] = useState(false);
  console.log("useCreateDocumentFormHandler initialized");
  const typeToIdMap: Record<string, string> = {
    DO: "36c25729-34a0-419a-8a93-cdda243168ab",
    RDO: "89e5fd4b-e837-44ad-982e-80559a3274e0",
    TI: "tax_invoice",
    MSR: "maintenance_service_report",
  };

  const onSubmit = async (data: any) => {
    console.log("Form submitted with data:", data);
    try {
      setIsDocumentTemplateUpdating(true);
      const token = await getToken();
      const documentTemplateId = typeToIdMap[data.type] || data.type;

      await request(
        {
          path: "/documents/basic",
          method: "POST",
        },
        {
          type: data.type,
          config: {},
          documentTemplateId: documentTemplateId,
        },
        token ?? undefined
      );

      router.push(ROUTES.DOCUMENTS);
    } catch (error) {
      console.error("Error submitting form:", error);
    } finally {
      setIsDocumentTemplateUpdating(false);
    }
  };

  return {
    control,
    handleSubmit,
    onSubmit,
    watch,
    isDocumentTemplateUpdating,
    isDirty,
  };
}
