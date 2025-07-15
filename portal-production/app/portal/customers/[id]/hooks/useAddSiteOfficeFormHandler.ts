import { useForm, useFieldArray } from "react-hook-form";
import { useParams } from "next/navigation";
// import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import * as yup from "yup";
import { yupResolver } from "@hookform/resolvers/yup";
import { toast } from "react-toastify";
import { useGetSiteOffices } from "./useGetSiteOffices";

interface ContactDetail {
  name?: string;
  email?: string;
  phone?: string;
}
interface AddSiteOfficeFormData {
  name: string;
  address?: string;
  contactDetails?: ContactDetail[];
}

interface useAddSiteOfficeFormHandlerProps {
  onSuccess?: () => void;
}

export default function useAddSiteOfficeFormHandler({ onSuccess }: useAddSiteOfficeFormHandlerProps = {}) {
  const { organization } = useOrganization();
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const organizationId = organization?.id;
  const { siteOffices, isLoading, refetch } = useGetSiteOffices();
  const params = useParams();
  const customerId = params?.id as string;

  const siteOfficeSchema = yup.object().shape({
    name: yup.string().required("Site Office name is required"),
    address: yup.string().notRequired(),
    contactDetails: yup.array().of(
      yup.object().shape({
        name: yup.string().notRequired(),
        email: yup.string().email("Invalid email").notRequired(),
        phone: yup.string().notRequired(),
      })
    ),
  });

  const {
    control,
    handleSubmit,
    reset,
    formState: { isSubmitting },
  } = useForm<AddSiteOfficeFormData>({
    defaultValues: {
      name: "",
      address: "",
      contactDetails: [{ name: "", email: "", phone: "" }],
    },
    resolver: yupResolver(siteOfficeSchema),
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "contactDetails",
  });

  // Add inventory mutation
  const { mutate: addSiteOffice, isPending: isSiteOfficeUpdating } = useMutation({
    mutationFn: async (data: AddSiteOfficeFormData) => {
      const token = await getToken();
      if (!token || !organizationId) throw new Error("No token or organization ID");

      const response = await request(
        {
          path: `/customers/${customerId}/site-offices`,
          method: "POST",
        },
        {
          ...data,
          customerId,
        },
        token
      );

      if (!response.success) {
        throw new Error(response.message || "Failed to create site office");
      }

      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["site-offices"] });
      toast.success("Site office created successfully");
      reset();
      onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to create site office");
    },
  });

  const onSubmit = (data: AddSiteOfficeFormData) => {
    addSiteOffice(data);
  };

  const fetchSiteOfficeById = useCallback(
    async (siteOfficeId: string) => {
      const token = await getToken();
      if (!token || !organizationId) throw new Error("No token or organization ID");

      const response = await request(
        {
          path: `/customers/site-offices/${siteOfficeId}`,
          method: "GET",
        },
        {},
        token
      );

      if (!response.success) {
        throw new Error(response.message || "Failed to fetch site office");
      }

      return response.data;
    },
    [getToken, organizationId]
  );

  return {
    control,
    handleSubmit,
    onSubmit,
    isSiteOfficeUpdating,
    reset,
    fields,
    append,
    remove,
    isSubmitting,
    fetchSiteOfficeById,
  };
}
