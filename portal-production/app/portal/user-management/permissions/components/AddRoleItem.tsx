import React, { useState } from "react";
import { Box, Button, Drawer, Grid, Typography, FormControl, InputLabel, Select, MenuItem, Chip, Alert, Divider } from "@mui/material";
import { useForm } from "react-hook-form";
import { useAuth } from "@clerk/nextjs";
import FormInputBox from "@/form-components/FormInputBox";
import FormTextarea from "@/form-components/FormTextArea";
import { useGetPermissions } from "../hooks/useGetPermissions";
import SecurityIcon from "@mui/icons-material/Security";

interface Props {
  open: boolean;
  onClose: () => void;
  onRoleCreated?: () => void;
}

interface Permission {
  id: string;
  name: string;
  description: string;
  resource: string;
  action: string;
}

interface GroupedPermissions {
  [key: string]: Permission[];
}

export default function AddRoleItem({ open, onClose, onRoleCreated }: Props) {
  const { getToken } = useAuth();
  const { permissions, loading: permissionsLoading } = useGetPermissions();
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string>("");

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({
    defaultValues: {
      name: "",
      description: "",
    },
  });

  const handlePermissionToggle = (permissionId: string) => {
    setSelectedPermissions((prev) => (prev.includes(permissionId) ? prev.filter((id) => id !== permissionId) : [...prev, permissionId]));
  };

  const onSubmit = async (data: any) => {
    if (selectedPermissions.length === 0) {
      setError("Please select at least one permission");
      return;
    }

    setError("");
    setIsSubmitting(true);

    try {
      const token = await getToken();
      if (!token) {
        throw new Error("No authentication token available");
      }

      const roleData = {
        name: data.name,
        description: data.description,
        permissionIds: selectedPermissions,
      };

      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}/roles`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(roleData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to create role");
      }

      const result = await response.json();

      if (result.success !== false) {
        // Reset form and close drawer after successful creation
        reset({
          name: "",
          description: "",
        });
        setSelectedPermissions([]);
        onClose();

        // Call the callback to refresh the roles list
        if (onRoleCreated) {
          onRoleCreated();
        }
      } else {
        throw new Error(result.message || "Failed to create role");
      }
    } catch (error: any) {
      console.error("Error creating role:", error);
      setError(error.message || "Failed to create role");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Group permissions by resource
  const permissionsArray = Array.isArray(permissions) ? permissions : [];
  const groupedPermissions: GroupedPermissions = permissionsArray.reduce((acc: GroupedPermissions, permission) => {
    const resource = permission.resource;
    if (!acc[resource]) {
      acc[resource] = [];
    }
    acc[resource].push(permission);
    return acc;
  }, {});

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
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
            <SecurityIcon sx={{ color: "#1976d2", fontSize: 28 }} />
            <Typography
              variant="h5"
              sx={{
                color: "#1a1a1a",
                fontWeight: 600,
                fontSize: "1.5rem",
              }}
            >
              Create New Role
            </Typography>
          </Box>
          <Typography variant="body2" sx={{ color: "#666666" }}>
            Add a new role with specific permissions and access controls
          </Typography>
        </Box>

        {/* Form Content */}
        <Box
          sx={{
            flex: 1,
            p: 3,
            overflowY: "auto",
            backgroundColor: "#ffffff",
          }}
        >
          <form onSubmit={handleSubmit(onSubmit)}>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {error && (
                <Alert
                  severity="error"
                  onClose={() => setError("")}
                  sx={{
                    backgroundColor: "#ffebee",
                    color: "#c62828",
                    "& .MuiAlert-icon": { color: "#c62828" },
                  }}
                >
                  {error}
                </Alert>
              )}

              <Grid container spacing={3}>
                <Grid item xs={12}>
                  <FormInputBox
                    label="Role Name"
                    control={control}
                    name="name"
                    placeHolder="Enter role name"
                    rules={{
                      required: "Role name is required",
                    }}
                    error={!!errors.name}
                    helperText={errors.name?.message as string}
                  />
                </Grid>

                <Grid item xs={12}>
                  <FormTextarea label="Description" control={control} name="description" placeHolder="Enter role description" rows={3} />
                </Grid>

                <Grid item xs={12}>
                  <FormControl fullWidth>
                    <InputLabel id="select-permissions-label" sx={{ color: "#666666" }}>
                      Select Permissions
                    </InputLabel>
                    <Select
                      labelId="select-permissions-label"
                      id="select-permissions"
                      label="Select Permissions"
                      multiple
                      value={selectedPermissions}
                      onChange={(e) => setSelectedPermissions(e.target.value as string[])}
                      renderValue={(selected) => (
                        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                          {selected.map((value) => {
                            const permission = permissionsArray.find((p) => p.id === value);
                            return (
                              <Chip
                                key={value}
                                label={permission?.name || value}
                                size="small"
                                sx={{
                                  backgroundColor: "#e3f2fd",
                                  color: "#1976d2",
                                  fontWeight: 500,
                                  "& .MuiChip-deleteIcon": {
                                    color: "#1976d2",
                                    "&:hover": { color: "#1565c0" },
                                  },
                                }}
                                onDelete={() => handlePermissionToggle(value)}
                              />
                            );
                          })}
                        </Box>
                      )}
                      MenuProps={{
                        PaperProps: {
                          sx: {
                            bgcolor: "#fff",
                            color: "#222",
                            maxHeight: 400,
                          },
                        },
                      }}
                      sx={{
                        "& .MuiOutlinedInput-notchedOutline": {
                          borderColor: "#e0e0e0",
                        },
                        "&:hover .MuiOutlinedInput-notchedOutline": {
                          borderColor: "#1976d2",
                        },
                        "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
                          borderColor: "#1976d2",
                        },
                        bgcolor: "#fff",
                      }}
                      disabled={permissionsLoading}
                    >
                      {permissionsLoading ? (
                        <MenuItem disabled sx={{ color: "#666" }}>
                          Loading permissions...
                        </MenuItem>
                      ) : (
                        Object.entries(groupedPermissions)
                          .map(([resource, perms]) => [
                            <MenuItem
                              key={`header-${resource}`}
                              disabled
                              sx={{
                                fontWeight: "bold",
                                color: "#1976d2",
                                backgroundColor: "#f5f5f5",
                                fontSize: "0.875rem",
                              }}
                            >
                              {resource.charAt(0).toUpperCase() + resource.slice(1)}
                            </MenuItem>,
                            ...perms.map((permission) => (
                              <MenuItem key={permission.id} value={permission.id} sx={{ color: "#222", pl: 3 }}>
                                <Box>
                                  <Typography variant="body2" sx={{ fontWeight: 500, color: "#222" }}>
                                    {permission.name}
                                  </Typography>
                                  <Typography variant="caption" sx={{ color: "#666" }}>
                                    {permission.description}
                                  </Typography>
                                </Box>
                              </MenuItem>
                            )),
                          ])
                          .flat()
                      )}
                    </Select>
                  </FormControl>
                </Grid>
              </Grid>
            </Box>
          </form>
        </Box>

        {/* Footer */}
        <Box
          sx={{
            p: 3,
            borderTop: "1px solid #e0e0e0",
            backgroundColor: "#f8f9fa",
          }}
        >
          <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 2 }}>
            <Button
              variant="outlined"
              onClick={() => {
                reset({
                  name: "",
                  description: "",
                });
                setSelectedPermissions([]);
                setError("");
                onClose();
              }}
              disabled={isSubmitting}
              sx={{
                borderColor: "#666666",
                color: "#666666",
                "&:hover": {
                  borderColor: "#1976d2",
                  color: "#1976d2",
                },
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="contained"
              color="primary"
              disabled={isSubmitting || permissionsLoading}
              onClick={handleSubmit(onSubmit)}
              sx={{
                backgroundColor: "#1976d2",
                "&:hover": {
                  backgroundColor: "#1565c0",
                },
                "&:disabled": {
                  backgroundColor: "#e0e0e0",
                  color: "#999999",
                },
              }}
            >
              {isSubmitting ? "Creating..." : "Create Role"}
            </Button>
          </Box>
        </Box>
      </Box>
    </Drawer>
  );
}
