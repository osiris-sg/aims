"use client";

import React, { useEffect, useMemo } from "react";
import { Box, Button, Divider, Typography } from "@mui/material";
import { useAuth } from "@clerk/nextjs";
import { useForm } from "react-hook-form";
import FormInputBox from "@/form-components/FormInputBox";
import FormImage from "@/form-components/FormImage";
import { useOrganization } from "@/app/portal/hooks/useOrganization";
import { uploadImage } from "@/helpers/imageUploader";
import { toast } from "react-toastify";

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
    if (!token || !organization?.id) {
      toast.error("Missing authentication or organization.");
      return;
    }

    const toastId = toast.loading("Saving organization...");

    // Extract keys from FormImage values
    const payload: any = {
      name: data.name,
      address: data.address,
      phoneNumber: data.phoneNumber,
      registrationNumber: data.registrationNumber,
    };

    const getFirstItem = (val: any) => (Array.isArray(val) && val[0]?.data ? val[0].data : undefined);
    const logoVal = getFirstItem(data.logo);
    const stampVal = getFirstItem(data.defaultStamp);

    console.log("[OrgSettings] Raw form values", data);
    console.log("[OrgSettings] Extracted logo value:", logoVal);
    console.log("[OrgSettings] Extracted stamp value:", stampVal);

    // Handle logo: if it's a File/Blob, upload and store key; if it's a string, use it directly
    try {
      if (logoVal) {
        if (typeof logoVal === "string") {
          payload.logo = logoVal;
        } else {
          console.log("[OrgSettings] Uploading new logo...");
          const uploadedLogoKey = await uploadImage({ blob: logoVal, folderName: "logos", token });
          console.log("[OrgSettings] Uploaded logo key:", uploadedLogoKey);
          if (uploadedLogoKey) payload.logo = uploadedLogoKey;
        }
      }
    } catch (e) {
      console.error("[OrgSettings] Logo upload failed", e);
    }

    // Handle default stamp
    try {
      if (stampVal) {
        if (typeof stampVal === "string") {
          payload.defaultStamp = stampVal;
        } else {
          console.log("[OrgSettings] Uploading new default stamp...");
          const uploadedStampKey = await uploadImage({ blob: stampVal, folderName: "stamps", token });
          console.log("[OrgSettings] Uploaded stamp key:", uploadedStampKey);
          if (uploadedStampKey) payload.defaultStamp = uploadedStampKey;
        }
      }
    } catch (e) {
      console.error("[OrgSettings] Stamp upload failed", e);
    }

    console.log("[OrgSettings] Final payload to PATCH:", payload);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}/organizations/${organization.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      console.log("[OrgSettings] PATCH response status:", res.status);
      console.log("[OrgSettings] PATCH response body:", json);

      if (res.ok && json?.success !== false) {
        toast.update(toastId, { render: "Organization saved.", type: "success", isLoading: false, autoClose: 2000 });
      } else {
        const msg = json?.message || `Failed to save (status ${res.status})`;
        toast.update(toastId, { render: msg, type: "error", isLoading: false, autoClose: 4000 });
      }
    } catch (e: any) {
      console.error("[OrgSettings] PATCH error", e);
      toast.update(toastId, { render: e?.message || "Save failed", type: "error", isLoading: false, autoClose: 4000 });
    }
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
