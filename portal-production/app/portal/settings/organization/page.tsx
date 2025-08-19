"use client";

import React, { useEffect, useMemo } from "react";
import { Box, Button, Divider, Typography } from "@mui/material";
import { useAuth } from "@clerk/nextjs";
import { useForm } from "react-hook-form";
import FormInputBox from "@/form-components/FormInputBox";
import FormImage from "@/form-components/FormImage";
import { useOrganization } from "@/app/portal/hooks/useOrganization";

export default function OrganizationSettingsPage() {
  const { organization } = useOrganization();
  const { getToken } = useAuth();

  const defaultValues = useMemo(
    () => ({
      name: organization?.name || "",
      address: organization?.address || "",
      phoneNumber: organization?.phoneNumber || "",
      registrationNumber: organization?.registrationNumber || "",
      logo: organization?.logo ? [{ data: organization.logo }] : undefined,
      defaultStamp: organization?.defaultStamp ? [{ data: organization.defaultStamp }] : undefined,
    }),
    [organization]
  );

  const { control, handleSubmit, reset } = useForm<any>({ defaultValues });

  // When organization data becomes available, re-populate the form
  useEffect(() => {
    reset(defaultValues);
  }, [defaultValues, reset]);

  const onSubmit = async (data: any) => {
    const token = await getToken();
    if (!token || !organization?.id) return;

    // Extract keys from FormImage values
    const payload: any = {
      name: data.name,
      address: data.address,
      phoneNumber: data.phoneNumber,
      registrationNumber: data.registrationNumber,
    };

    const getFirstKey = (val: any) => (Array.isArray(val) && val[0]?.data ? val[0].data : undefined);
    const logo = getFirstKey(data.logo);
    const stamp = getFirstKey(data.defaultStamp);
    if (typeof logo === "string") payload.logo = logo;
    if (typeof stamp === "string") payload.defaultStamp = stamp;

    await fetch(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}/organizations/${organization.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    // no hard refresh here; OrganizationContext will continue returning previous values until reload
  };

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
      <Typography variant="h5" sx={{ fontWeight: 700 }}>
        Organization Settings
      </Typography>
      <Divider />

      <Box component="form" onSubmit={handleSubmit(onSubmit)} sx={{ display: "flex", flexDirection: "column", gap: 2, maxWidth: 720 }}>
        <FormInputBox control={control} name="name" label="Organization Name" placeHolder="Enter name" />
        <FormInputBox control={control} name="address" label="Address" placeHolder="Enter address" />
        <FormInputBox control={control} name="phoneNumber" label="Phone Number" placeHolder="Enter phone" />
        <FormInputBox control={control} name="registrationNumber" label="Registration No" placeHolder="Enter registration number" />

        <Box>
          <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600 }}>
            Logo
          </Typography>
          <FormImage control={control} name="logo" numberOfUploaders={1} />
        </Box>

        <Box>
          <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600 }}>
            Default Company Stamp
          </Typography>
          <FormImage control={control} name="defaultStamp" numberOfUploaders={1} />
        </Box>

        <Button type="submit" variant="contained" color="primary" sx={{ alignSelf: "flex-start" }}>
          Save
        </Button>
      </Box>
    </Box>
  );
}
