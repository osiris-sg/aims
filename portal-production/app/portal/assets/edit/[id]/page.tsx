"use client";
import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useOrganization, useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";
import MainCard from "@/components/MainCard";
import { Box, Button, TextField, MenuItem, Typography, Avatar } from "@mui/material";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ROUTES } from "@/routes";

const assetSchema = z.object({
  name: z.string().min(1, "Name is required"),
  skuKey: z.string().min(1, "SKU Key is required"),
  categoryId: z.string().min(1, "Category is required"),
  status: z.string().min(1, "Status is required"),
  image: z.any().optional(),
});

type AssetFormData = z.infer<typeof assetSchema>;

export default function EditAssetPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const { organization } = useOrganization();
  const { getToken } = useAuth();
  const organizationId = organization?.id;
  const [categories, setCategories] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentImage, setCurrentImage] = useState<string>("");

  const {
    control,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<AssetFormData>({
    resolver: zodResolver(assetSchema),
    defaultValues: {
      name: "",
      skuKey: "",
      categoryId: "",
      status: "",
      image: undefined,
    },
  });

  const fetchCategories = async () => {
    if (!organizationId) return;

    try {
      const token = await getToken();
      if (!token) return;

      const response = await request(
        {
          path: `/categories`,
          method: "GET",
        },
        { organizationId },
        token
      );

      if (response.success) {
        setCategories(response.data);
      }
    } catch (error) {
      console.error("Error fetching categories:", error);
    }
  };

  const fetchAsset = async () => {
    if (!organizationId) return;

    try {
      const token = await getToken();
      if (!token) return;

      const response = await request(
        {
          path: `/assets/${params.id}`,
          method: "GET",
        },
        {},
        token
      );

      if (response.success) {
        const asset = response.data;
        setCurrentImage(asset.image);
        reset({
          name: asset.name || "",
          skuKey: asset.skuKey || "",
          categoryId: asset.categoryId || "",
          status: asset.status || "",
          image: undefined,
        });
      }
    } catch (error) {
      console.error("Error fetching asset:", error);
    }
  };

  useEffect(() => {
    fetchCategories();
    fetchAsset();
  }, [organizationId, params.id]);

  const onSubmit = async (data: AssetFormData) => {
    if (!organizationId) return;
    setIsLoading(true);

    try {
      const token = await getToken();
      if (!token) return;

      const formData = new FormData();
      Object.entries(data).forEach(([key, value]) => {
        if (value !== undefined) {
          formData.append(key, value);
        }
      });
      formData.append("organizationId", organizationId);

      const response = await request(
        {
          path: `/assets/${params.id}`,
          method: "PUT",
        },
        formData,
        token,
        true,
        true
      );

      if (response.success) {
        router.push(ROUTES.ASSETS);
      }
    } catch (error) {
      console.error("Error updating asset:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <MainCard>
      <Box component="form" onSubmit={handleSubmit(onSubmit)} sx={{ maxWidth: 600, mx: "auto", p: 3 }}>
        <Typography variant="h5" sx={{ mb: 3 }}>
          Edit Asset
        </Typography>

        {currentImage && (
          <Box sx={{ mb: 3, display: "flex", justifyContent: "center" }}>
            <Avatar src={`${process.env.NEXT_PUBLIC_RESOURCE_URL}${currentImage}`} alt="Current Asset" sx={{ width: 100, height: 100, borderRadius: "0.4rem" }} />
          </Box>
        )}

        <Controller name="name" control={control} render={({ field }) => <TextField {...field} label="Asset Name" fullWidth error={!!errors.name} helperText={errors.name?.message} sx={{ mb: 2 }} />} />

        <Controller name="skuKey" control={control} render={({ field }) => <TextField {...field} label="SKU Key" fullWidth error={!!errors.skuKey} helperText={errors.skuKey?.message} sx={{ mb: 2 }} />} />

        <Controller
          name="categoryId"
          control={control}
          render={({ field }) => (
            <TextField {...field} select label="Category" fullWidth error={!!errors.categoryId} helperText={errors.categoryId?.message} sx={{ mb: 2 }}>
              {categories.map((category) => (
                <MenuItem key={category.id} value={category.id}>
                  {category.name}
                </MenuItem>
              ))}
            </TextField>
          )}
        />

        <Controller
          name="status"
          control={control}
          render={({ field }) => (
            <TextField {...field} select label="Status" fullWidth error={!!errors.status} helperText={errors.status?.message} sx={{ mb: 2 }}>
              <MenuItem value="active">Active</MenuItem>
              <MenuItem value="inactive">Inactive</MenuItem>
            </TextField>
          )}
        />

        <Controller
          name="image"
          control={control}
          render={({ field: { onChange, value, ...field } }) => (
            <TextField
              {...field}
              type="file"
              fullWidth
              error={!!errors.image}
              helperText={errors.image?.message?.toString()}
              onChange={(e) => {
                const target = e.target as HTMLInputElement;
                onChange(target.files?.[0]);
              }}
              sx={{ mb: 3 }}
            />
          )}
        />

        <Box sx={{ display: "flex", gap: 2, justifyContent: "flex-end" }}>
          <Button variant="outlined" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={isLoading}>
            {isLoading ? "Saving..." : "Save Changes"}
          </Button>
        </Box>
      </Box>
    </MainCard>
  );
}
