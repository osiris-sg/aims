import React, { useState, useEffect } from "react";
import { Box, Button, Drawer, Grid, Typography, FormControl, InputLabel, Select, MenuItem, Chip, Alert, IconButton, InputAdornment, Divider } from "@mui/material";
import { useForm } from "react-hook-form";
import FormInputBox from "@/form-components/FormInputBox";
import useAddUserStates from "../hooks/useAddUser";
import { request } from "@/helpers/request";
import { useAuth } from "@clerk/nextjs";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import PersonAddIcon from "@mui/icons-material/PersonAdd";

interface Props {
  open: boolean;
  onClose: () => void;
  onUserCreated?: () => void;
}

interface Role {
  id: string;
  name: string;
  description: string;
}

export default function AddUser({ open, onClose, onUserCreated }: Props) {
  const { createUser, loading } = useAddUserStates();
  const { getToken } = useAuth();
  const [roles, setRoles] = useState<Role[]>([]);
  const [organizations, setOrganizations] = useState<any[]>([]);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string>();
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [error, setError] = useState<string>("");
  const [showPassword, setShowPassword] = useState(false);

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      password: "",
    },
  });

  // Fetch available roles
  useEffect(() => {
    console.log("organizations", organizations);
  }, [organizations]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const token = await getToken();
        if (!token) return;

        // const [rolesResponse, organizationsResponse] = await Promise.all([request({ method: "GET", path: "/roles" }, {}, token), request({ method: "GET", path: "/admin/organizations" }, {}, token)]);
        const organizationsResponse = await request({ method: "GET", path: "/admin/organizations" }, {}, token);

        // if (rolesResponse.success && rolesResponse.data?.roles) {
        //   setRoles(rolesResponse.data.roles);
        // } else if (rolesResponse.success && Array.isArray(rolesResponse.data)) {
        //   setRoles(rolesResponse.data);
        // }

        if (organizationsResponse.success && organizationsResponse.data?.organizations) {
          setOrganizations(organizationsResponse.data.organizations);
        } else if (organizationsResponse.success && Array.isArray(organizationsResponse.data)) {
          setOrganizations(organizationsResponse.data);
        }
      } catch (error) {
        console.error("Error fetching roles:", error);
      }
    };

    if (open) {
      fetchData();
    }
  }, [open, getToken]);

  useEffect(() => {
    const fetchRoles = async () => {
      if (!selectedOrganizationId) {
        setRoles([]);
        setSelectedRoles([]);
        return;
      }
      const token = await getToken();
      if (!token) return;
      const rolesResponse = await request({ method: "GET", path: `/admin/roles/${selectedOrganizationId}` }, {}, token);

      console.log("Roles:", rolesResponse);

      if (rolesResponse.success && Array.isArray(rolesResponse.data)) {
        setRoles(rolesResponse.data);
      } else if (rolesResponse.success && rolesResponse.data?.roles) {
        setRoles(rolesResponse.data.roles);
      } else {
        setRoles([]);
      }
      setSelectedRoles([]);
    };
    fetchRoles();
  }, [selectedOrganizationId, getToken]);

  const onSubmit = async (data: any) => {
    if (selectedRoles.length === 0) {
      setError("Please select at least one role");
      return;
    }

    if (selectedOrganizationId === "") {
      setError("Please select at least one organization");
      return;
    }

    setError("");
    try {
      if (!selectedOrganizationId) {
        setError("Please select an organization");
        return;
      }

      console.log("Creating User:", data, selectedRoles, selectedOrganizationId);

      const response = await createUser({
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        organizationId: selectedOrganizationId,
        password: data.password,
        roleIds: selectedRoles,
      });

      console.log("Creating User Response:", response);

      // Reset form and close drawer after successful creation
      reset({
        firstName: "",
        lastName: "",
        email: "",
        password: "",
      });
      setSelectedRoles([]);
      setShowPassword(false);
      onClose();

      // Call the callback to refresh the users list
      if (onUserCreated) {
        onUserCreated();
      }
    } catch (error: any) {
      setError(error.message || "Failed to create user");
    }
  };

  const handleRoleToggle = (roleId: string) => {
    setSelectedRoles((prev) => (prev.includes(roleId) ? prev.filter((id) => id !== roleId) : [...prev, roleId]));
  };

  const togglePasswordVisibility = () => {
    setShowPassword(!showPassword);
  };

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
            <PersonAddIcon sx={{ color: "#1976d2", fontSize: "1.75rem" }} />
            <Typography
              variant="h5"
              sx={{
                color: "#1a1a1a",
                fontWeight: 600,
                fontSize: "1.5rem",
              }}
            >
              Create New User
            </Typography>
          </Box>
          <Typography variant="body2" sx={{ color: "#666666" }}>
            Add a new user account with email and role assignments
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
                <Grid item xs={6}>
                  <FormInputBox
                    label="First Name"
                    control={control}
                    name="firstName"
                    placeHolder="Enter first name"
                    rules={{
                      required: "First name is required",
                    }}
                    error={!!errors.firstName}
                    helperText={errors.firstName?.message as string}
                  />
                </Grid>

                <Grid item xs={6}>
                  <FormInputBox
                    label="Last Name"
                    control={control}
                    name="lastName"
                    placeHolder="Enter last name"
                    error={!!errors.lastName}
                    helperText={errors.lastName?.message as string}
                  />
                </Grid>

                <Grid item xs={12}>
                  <FormInputBox
                    label="Email Address"
                    control={control}
                    name="email"
                    placeHolder="Enter email address"
                    rules={{
                      required: "Email is required",
                      pattern: {
                        value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
                        message: "Invalid email address",
                      },
                    }}
                    error={!!errors.email}
                    helperText={errors.email?.message as string}
                  />
                </Grid>

                <Grid item xs={12}>
                  <FormInputBox
                    label="Password"
                    control={control}
                    name="password"
                    type={showPassword ? "text" : "password"}
                    placeHolder="Enter password"
                    rules={{
                      required: "Password is required",
                      minLength: {
                        value: 8,
                        message: "Password must be at least 8 characters",
                      },
                    }}
                    error={!!errors.password}
                    helperText={errors.password?.message as string}
                  />
                  <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 1 }}>
                    <Button
                      size="small"
                      onClick={togglePasswordVisibility}
                      sx={{
                        color: "#666666",
                        textTransform: "none",
                        minWidth: "auto",
                        p: 0.5,
                      }}
                    >
                      {showPassword ? "Hide password" : "Show password"}
                    </Button>
                  </Box>
                </Grid>

                <Grid item xs={12}>
                  <FormControl fullWidth required>
                    <InputLabel id="select-organization-label" sx={{ color: "#666666" }}>
                      Select Organization
                    </InputLabel>
                    <Select
                      labelId="select-organization-label"
                      id="select-organization"
                      label="Select Organization"
                      value={selectedOrganizationId || ""}
                      onChange={(e) => setSelectedOrganizationId(e.target.value)}
                      MenuProps={{
                        PaperProps: {
                          sx: {
                            bgcolor: "#fff", // White background
                            color: "#222", // Dark text
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
                        bgcolor: "#fff", // White background for the select input itself
                      }}
                    >
                      {organizations.map((org) => (
                        <MenuItem key={org.id} value={org.id}>
                          {org.name}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>

                <Grid item xs={12}>
                  <FormControl fullWidth>
                    <InputLabel id="select-roles-label" sx={{ color: "#666666" }}>
                      Select Roles
                    </InputLabel>
                    <Select
                      labelId="select-roles-label"
                      id="select-roles"
                      label="Select Roles"
                      multiple
                      value={selectedRoles}
                      disabled={!selectedOrganizationId}
                      onChange={(e) => setSelectedRoles(e.target.value as string[])}
                      renderValue={(selected) => (
                        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                          {selected.map((value) => {
                            const role = roles.find((r) => r.id === value);
                            return (
                              <Chip
                                key={value}
                                label={role?.name || value}
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
                                onDelete={() => handleRoleToggle(value)}
                              />
                            );
                          })}
                        </Box>
                      )}
                      MenuProps={{
                        PaperProps: {
                          sx: {
                            bgcolor: "#fff", // White background
                            color: "#222", // Dark text
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
                        bgcolor: "#fff", // White background for the select input itself
                      }}
                    >
                      {roles.map((role) => (
                        <MenuItem key={role.id} value={role.id} sx={{ color: "#222" }}>
                          <Box>
                            <Typography variant="body2" sx={{ fontWeight: 500, color: "#222" }}>
                              {role.name}
                            </Typography>
                            {role.description && (
                              <Typography variant="caption" sx={{ color: "#666" }}>
                                {role.description}
                              </Typography>
                            )}
                          </Box>
                        </MenuItem>
                      ))}
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
                  firstName: "",
                  lastName: "",
                  email: "",
                  password: "",
                });
                setSelectedRoles([]);
                setShowPassword(false);
                setError("");
                onClose();
              }}
              disabled={loading}
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
              disabled={loading}
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
              {loading ? "Creating..." : "Create User"}
            </Button>
          </Box>
        </Box>
      </Box>
    </Drawer>
  );
}
