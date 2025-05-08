/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useForm } from "react-hook-form";
import { useDispatch } from "react-redux";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@clerk/nextjs";
import { customerActions } from "../slice";

export default function useAddCustomerFormHandler() {
  const dispatch = useDispatch();
  const { getToken } = useAuth();
  const { organization } = useOrganization();

  const { control, handleSubmit } = useForm({
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      address: "",
    },
  });

  const onSubmit = async (data: any) => {
    try {
      const token = await getToken();
      dispatch(
        customerActions.createCustomer({
          ...data,
          organizationId: organization?.id || "",
          token,
        })
      );
    } catch (error) {
      console.error("Error submitting form:", error);
    }
  };

  return {
    control,
    handleSubmit,
    onSubmit,
  };
}
