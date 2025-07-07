"use client";

import React, { useState } from "react";
import { Box, Button, Drawer, Grid, Typography, Alert } from "@mui/material";
import { useForm } from "react-hook-form";
import FormInputBox from "@/form-components/FormInputBox";
import { request } from "@/helpers/request";
import { useAuth } from "@clerk/nextjs";
import BusinessIcon from "@mui/icons-material/Business";

interface Props {
  open: boolean;
  onClose: () => void;
  onOrganizationCreated?: () => void;
}

export default function AddOrganizationItem({ open, onClose, onOrganizationCreated }: Props) {
  const { getToken } = useAuth();
  const [error, setError] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({
    defaultValues: {
      name: "",
      id: "",
    },
  });

  const onSubmit = async (data: any) => {
    setError("");
    setIsSubmitting(true);

    console.log("📝 Submitting organization creation:", data);

    try {
      const token = await getToken();
      if (!token) {
        console.error("❌ No authentication token available");
        throw new Error("No authentication token available");
      }

      console.log("🔑 Token obtained successfully");

      const organizationData = {
        name: data.name.trim(),
        ...(data.id.trim() && { id: data.id.trim() }), // Only include id if provided
      };

      console.log("📦 Organization data to send:", organizationData);

      const response = await request(
        {
          path: "/organizations",
          method: "POST",
        },
        organizationData,
        token
      );

      console.log("📡 Organization creation response:", response);

      if (response.success) {
        console.log("✅ Organization created successfully");
        // Reset form and close drawer after successful creation
        reset({
          name: "",
          id: "",
        });
        onClose();

        // Call the callback to refresh the organizations list
        if (onOrganizationCreated) {
          onOrganizationCreated();
        }
      } else {
        console.error("❌ Failed to create organization:", response);
        throw new Error(response.message || "Failed to create organization");
      }
    } catch (error: any) {
      console.error("💥 Error creating organization:", error);
      setError(error.message || "Failed to create organization");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setError("");
      reset();
      onClose();
    }
  };

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={handleClose}
      PaperProps={{
        sx: {
          width: 500,
          backgroundColor: "#ffffff",
          boxShadow: "0 8px 32px rgba(0, 0, 0, 0.12)",
        },
      }}
    >
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          height: "100%",
          backgroundColor: "#ffffff",
        }}
      >
        {/* Header */}
        <Box
          sx={{
            p: 3,
            borderBottom: "1px solid #e0e0e0",
            backgroundColor: "#f8f9fa",
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 1 }}>
            <BusinessIcon sx={{ color: "#1976d2", fontSize: 28 }} />
            <Typography
              variant="h5"
              sx={{
                color: "#1a1a1a",
                fontWeight: 600,
                fontSize: "1.5rem",
              }}
            >
              Add New Organization
            </Typography>
          </Box>
          <Typography variant="body2" sx={{ color: "#666666" }}>
            Create a new organization to manage users and resources
          </Typography>
        </Box>

        {/* Form Content */}
        <Box
          component="form"
          onSubmit={handleSubmit(onSubmit)}
          sx={{
            flexGrow: 1,
            display: "flex",
            flexDirection: "column",
            p: 3,
          }}
        >
          <Grid container spacing={3} sx={{ flexGrow: 1 }}>
            <Grid item xs={12}>
              <FormInputBox
                control={control}
                name="name"
                label="Organization Name"
                placeHolder="Enter organization name"
                required
                rules={{
                  required: "Organization name is required",
                  minLength: {
                    value: 2,
                    message: "Organization name must be at least 2 characters",
                  },
                }}
              />
            </Grid>

            <Grid item xs={12}>
              <FormInputBox
                control={control}
                name="id"
                label="Custom ID (Optional)"
                placeHolder="Enter custom organization ID"
                bottomText="Leave empty to auto-generate"
                rules={{
                  pattern: {
                    value: /^[a-zA-Z0-9-_]+$/,
                    message: "ID can only contain letters, numbers, hyphens, and underscores",
                  },
                }}
              />
            </Grid>

            {error && (
              <Grid item xs={12}>
                <Alert severity="error" sx={{ mb: 2 }}>
                  {error}
                </Alert>
              </Grid>
            )}
          </Grid>

          {/* Action Buttons */}
          <Box
            sx={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 2,
              pt: 3,
              borderTop: "1px solid #e0e0e0",
              mt: "auto",
            }}
          >
            <Button
              variant="outlined"
              onClick={handleClose}
              disabled={isSubmitting}
              sx={{
                borderColor: "#d0d0d0",
                color: "#666666",
                "&:hover": {
                  borderColor: "#999999",
                  backgroundColor: "#f5f5f5",
                },
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="contained"
              disabled={isSubmitting}
              sx={{
                backgroundColor: "#1976d2",
                "&:hover": {
                  backgroundColor: "#1565c0",
                },
              }}
            >
              {isSubmitting ? "Creating..." : "Create Organization"}
            </Button>
          </Box>
        </Box>
      </Box>
    </Drawer>
  );
}
