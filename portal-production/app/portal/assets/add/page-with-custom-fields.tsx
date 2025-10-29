"use client";

import React from "react";
import { Box, Button, Card, CardContent, Typography, Grid, TextField } from "@mui/material";
import { useForm, Controller } from "react-hook-form";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { toast } from "react-toastify";
import FormInputBox from "@/form-components/FormInputBox";
import FormSelect from "@/form-components/FormSelect";
import FormImage from "@/form-components/FormImage";
import { DynamicForm, useCustomFieldsSubmission } from "@/components/DynamicForm";
import { uploadImage } from "@/helpers/imageUploader";
import { useOrganization } from "../../hooks/useOrganization";

// This is an example of how to integrate custom fields into the existing Add Asset page
export default function AddAssetPageWithCustomFields() {
  const router = useRouter();
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const { submitWithCustomFields } = useCustomFieldsSubmission();

  const form = useForm({
    defaultValues: {
      name: "",
      skuKey: "",
      categoryId: "",
      description: "",
      price: "",
      parentAssetId: "",
      image: undefined,
      // Custom fields will be under this key
      customFields: {},
    },
  });

  const { control, handleSubmit, formState: { errors, isSubmitting } } = form;

  const onSubmit = async (data: any) => {
    try {
      const token = await getToken();
      if (!token || !organization?.id) {
        toast.error("Authentication required");
        return;
      }

      // Handle image upload if present
      let imageUrl = null;
      if (data.image && data.image[0]?.data) {
        const imageBlob = data.image[0].data;
        if (typeof imageBlob !== "string") {
          imageUrl = await uploadImage({
            blob: imageBlob,
            folderName: "assets",
            token,
          });
        } else {
          imageUrl = imageBlob;
        }
      }

      // Prepare the base asset data
      const baseAssetData = {
        name: data.name,
        skuKey: data.skuKey,
        categoryId: data.categoryId,
        description: data.description,
        price: data.price ? parseFloat(data.price) : null,
        parentAssetId: data.parentAssetId || null,
        image: imageUrl,
      };

      // Submit with custom fields using the helper
      const submitFunction = async (dataToSubmit: any) => {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_BACKEND_API_URL}/assets/create`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
              "x-organization-id": organization.id,
            },
            body: JSON.stringify(dataToSubmit),
          }
        );

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.message || "Failed to create asset");
        }

        return response.json();
      };

      await submitWithCustomFields(
        { ...baseAssetData, customFields: data.customFields },
        "Asset",
        submitFunction,
        token,
        organization.id
      );

      toast.success("Asset created successfully!");
      router.push("/portal/assets");
    } catch (error) {
      console.error("Error creating asset:", error);
      toast.error(error instanceof Error ? error.message : "Failed to create asset");
    }
  };

  // Base fields component - your existing form fields
  const baseFields = (
    <Grid container spacing={2}>
      <Grid item xs={12} md={6}>
        <FormInputBox
          control={control}
          name="name"
          label="Asset Name"
          placeHolder="Enter asset name"
          rules={{ required: "Asset name is required" }}
        />
      </Grid>
      <Grid item xs={12} md={6}>
        <FormInputBox
          control={control}
          name="skuKey"
          label="SKU Key"
          placeHolder="Enter SKU key"
          rules={{ required: "SKU key is required" }}
        />
      </Grid>
      <Grid item xs={12} md={6}>
        <FormSelect
          control={control}
          name="categoryId"
          label="Category"
          menuItems={[
            // This should be fetched from API
            { value: "cat1", label: "Category 1" },
            { value: "cat2", label: "Category 2" },
          ]}
          menuTitle="Category"
          required
        />
      </Grid>
      <Grid item xs={12} md={6}>
        <FormInputBox
          control={control}
          name="price"
          label="Price"
          type="number"
          placeHolder="Enter price"
        />
      </Grid>
      <Grid item xs={12}>
        <FormInputBox
          control={control}
          name="description"
          label="Description"
          placeHolder="Enter description"
        />
      </Grid>
      <Grid item xs={12} md={6}>
        <FormSelect
          control={control}
          name="parentAssetId"
          label="Parent Asset (Optional)"
          menuItems={[
            // This should be fetched from API
            { value: "", label: "None" },
            { value: "parent1", label: "Parent Asset 1" },
          ]}
          menuTitle="Parent Asset"
        />
      </Grid>
      <Grid item xs={12}>
        <Typography variant="subtitle1" sx={{ mb: 1 }}>
          Asset Image
        </Typography>
        <FormImage control={control} name="image" numberOfUploaders={1} />
      </Grid>
    </Grid>
  );

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" sx={{ mb: 3, fontWeight: 700 }}>
        Add New Asset
      </Typography>

      <Card>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)}>
            {/* Dynamic form with both base fields and custom fields */}
            <DynamicForm
              entityType="Asset"
              form={form}
              baseFields={baseFields}
              includeCustomFields={true}
            />

            <Box sx={{ mt: 3, display: "flex", gap: 2 }}>
              <Button
                type="submit"
                variant="contained"
                disabled={isSubmitting}
              >
                {isSubmitting ? "Creating..." : "Create Asset"}
              </Button>
              <Button
                variant="outlined"
                onClick={() => router.push("/portal/assets")}
              >
                Cancel
              </Button>
            </Box>
          </form>
        </CardContent>
      </Card>
    </Box>
  );
}