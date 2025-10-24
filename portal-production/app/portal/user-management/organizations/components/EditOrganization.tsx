"use client";

import React, { useState, useEffect } from "react";
import { Box, Button, Drawer, Grid, Typography, Alert } from "@mui/material";
import { useForm } from "react-hook-form";
import FormInputBox from "@/form-components/FormInputBox";
import { request } from "@/helpers/request";
import { useAuth } from "@clerk/nextjs";
import EditIcon from "@mui/icons-material/Edit";

interface Props {
  open: boolean;
  onClose: () => void;
  onOrganizationUpdated?: () => void;
  organization: any;
}

export default function EditOrganization({ open, onClose, onOrganizationUpdated, organization }: Props) {
  const { getToken } = useAuth();
  const [error, setError] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    control,
    handleSubmit,
    reset,
    setValue,
    formState: { errors },
  } = useForm({
    defaultValues: {
      name: "",
    },
  });

  // Populate form when organization data is available
  useEffect(() => {
    if (organization && open) {
      setValue("name", organization.name || "");
    }
  }, [organization, open, setValue]);

  const onSubmit = async (data: any) => {
    if (!organization?.id) return;

    setError("");
    setIsSubmitting(true);

    try {
      const token = await getToken();
      if (!token) {
        throw new Error("No authentication token available");
      }

      const organizationData = {
        name: data.name.trim(),
      };

      const response = await request(
        {
          path: `/organizations/${organization.id}`,
          method: "PATCH",
        },
        organizationData,
        token
      );

      if (response.success) {
        onClose();

        // Call the callback to refresh the organizations list
        if (onOrganizationUpdated) {
          onOrganizationUpdated();
        }
      } else {
        throw new Error(response.message || "Failed to update organization");
      }
    } catch (error: any) {
      console.error("Error updating organization:", error);
      setError(error.message || "Failed to update organization");
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
            <EditIcon sx={{ color: "#1976d2", fontSize: "1.75rem" }} />
            <Typography
              variant="h5"
              sx={{
                color: "#1a1a1a",
                fontWeight: 600,
                fontSize: "1.5rem",
              }}
            >
              Edit Organization
            </Typography>
          </Box>
          <Typography variant="body2" sx={{ color: "#666666" }}>
            Update organization information
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

            {organization?.id && (
              <Grid item xs={12}>
                <Typography variant="body2" color="text.secondary">
                  <strong>Organization ID:</strong> {organization.id}
                </Typography>
              </Grid>
            )}

            {organization?.createdAt && (
              <Grid item xs={12}>
                <Typography variant="body2" color="text.secondary">
                  <strong>Created:</strong> {new Date(organization.createdAt).toLocaleString()}
                </Typography>
              </Grid>
            )}

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
              {isSubmitting ? "Updating..." : "Update Organization"}
            </Button>
          </Box>
        </Box>
      </Box>
    </Drawer>
  );
}
