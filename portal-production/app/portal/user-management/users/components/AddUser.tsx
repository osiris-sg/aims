import React, { useState, useEffect } from "react";
import { Box, Button, Drawer, Grid, Typography, FormControl, InputLabel, Select, MenuItem, Chip, Alert, IconButton, InputAdornment, Divider , alpha } from "@mui/material";
import { useForm } from "react-hook-form";
import FormInputBox from "@/form-components/FormInputBox";
import useAddUserStates from "../hooks/useAddUser";
import { request } from "@/helpers/request";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import { useAuth } from "@clerk/nextjs";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import PersonAddIcon from "@mui/icons-material/PersonAdd";

interface Props {
  open: boolean;
  onClose: () => void;
  onUserCreated?: () => void;
}

// Preset-role orgs (guru 2026-10-27): the client picks ONE built-in role and
// never sees permissions. Presets are told apart by their stored description
// prefix; 'field-tech' keeps its name (the app keys on it) but reads as
// "Technician (field app)".
const PRESET_PREFIX = "Preset · ";
const PRESET_LABEL: Record<string, string> = { "field-tech": "Technician (field app)" };
const presetLabel = (r: { name: string; description?: string | null }) => PRESET_LABEL[r.name] ?? r.name;
const presetSummary = (r: { description?: string | null }) => {
  const d = String(r.description ?? "");
  const i = d.indexOf(" — ");
  return d.startsWith(PRESET_PREFIX) && i > 0 ? d.slice(i + 3) : d;
};
const isPresetRole = (r: { name: string; description?: string | null }) => r.name !== "superadmin" && String(r.description ?? "").startsWith(PRESET_PREFIX);

interface Role {
  id: string;
  name: string;
  description: string;
}

export default function AddUser({ open, onClose, onUserCreated }: Props) {
  const { createUser, loading } = useAddUserStates();
  const { getToken } = useAuth();
  const [roles, setRoles] = useState<Role[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const { isRolePresetsEnabled } = useOrganizationFeatures();
  const visibleRoles = isRolePresetsEnabled ? roles.filter(isPresetRole) : roles;
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
      salesmanCode: "",
      salesmanMobile: "",
    },
  });

  // Fetch available roles
  useEffect(() => {
    const fetchRoles = async () => {
      try {
        const token = await getToken();
        if (!token) return;

        const response = await request(
          {
            method: "GET",
            path: "/roles",
          },
          {},
          token
        );

        if (response.success && response.data?.roles) {
          setRoles(response.data.roles);
        } else if (response.success && Array.isArray(response.data)) {
          setRoles(response.data);
        }
      } catch (error) {
        console.error("Error fetching roles:", error);
      }
    };

    if (open) {
      fetchRoles();
    }
  }, [open, getToken]);

  const onSubmit = async (data: any) => {
    if (selectedRoles.length === 0) {
      setError("Please select at least one role");
      return;
    }

    setError("");
    try {
      await createUser({
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        ...(data.password?.trim() ? { password: data.password.trim() } : {}),
        roleIds: selectedRoles,
        salesmanCode: data.salesmanCode || undefined,
        salesmanMobile: data.salesmanMobile || undefined,
      });

      // Reset form and close drawer after successful creation
      reset({
        firstName: "",
        lastName: "",
        email: "",
        password: "",
        salesmanCode: "",
      salesmanMobile: "",
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
          width: { xs: "100%", sm: 500 },
          // Theme tokens, not light-only hexes: this drawer rendered white
          // text-on-white (and black-on-black role names) in dark mode
          // (guru 2026-10-28).
          bgcolor: "background.paper",
          backgroundImage: "none",
          boxShadow: 8,
        },
      }}
    >
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          height: "100%",
          bgcolor: "background.paper",
        }}
      >
        {/* Header */}
        <Box
          sx={{
            p: 3,
            borderBottom: 1,
            borderColor: "divider",
            bgcolor: "surfaceTones.low",
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 1 }}>
            <PersonAddIcon sx={{ color: "primary.main", fontSize: "1.75rem" }} />
            <Typography
              variant="h5"
              sx={{
                color: "text.primary",
                fontWeight: 600,
                fontSize: "1.5rem",
              }}
            >
              Create New User
            </Typography>
          </Box>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            Add a new user account with email and role assignments
          </Typography>
        </Box>

        {/* Form Content */}
        <Box
          sx={{
            flex: 1,
            p: 3,
            overflowY: "auto",
            bgcolor: "background.paper",
          }}
        >
        <form onSubmit={handleSubmit(onSubmit)}>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {error && (
                <Alert
                  severity="error"
                  onClose={() => setError("")}
                  variant="outlined"
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
                    rules={{
                      required: "Last name is required",
                    }}
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
                      validate: (v: string) => !v || v.length >= 8 || "Password must be at least 8 characters",
                    }}
                    error={!!errors.password}
                    helperText={(errors.password?.message as string) || "Optional. Leave blank and they sign in with an email code."}
                  />
                  <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 1 }}>
                    <Button
                      size="small"
                      onClick={togglePasswordVisibility}
                      sx={{
                        color: "text.secondary",
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
                  <FormInputBox
                    label="Salesman Code"
                    control={control}
                    name="salesmanCode"
                    placeHolder="Enter salesman code (e.g., S001)"
                  />
                </Grid>

              {/* Their own contact number. Documents they raise stamp it into
                  the Salesman Mobile field automatically, so salespeople stop
                  retyping it on every quotation (Eve @ Biofuel, 2026-09-24). */}
              <Grid item xs={12}>
                  <FormInputBox
                    label="Salesman Mobile"
                    control={control}
                    name="salesmanMobile"
                    placeHolder="e.g., 9014 5879"
                  />
                </Grid>

              <Grid item xs={12}>
                  <FormControl fullWidth>
                    <InputLabel id="select-roles-label">
                      {isRolePresetsEnabled ? "Role" : "Select Roles"}
                    </InputLabel>
                    <Select
                      labelId="select-roles-label"
                      id="select-roles"
                      label={isRolePresetsEnabled ? "Role" : "Select Roles"}
                      multiple={!isRolePresetsEnabled}
                      value={isRolePresetsEnabled ? (selectedRoles[0] ?? "") : selectedRoles}
                      onChange={(e) => {
                        const v = e.target.value as string | string[];
                        setSelectedRoles(Array.isArray(v) ? v : v ? [v] : []);
                      }}
                      renderValue={(selected) => (
                        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                          {(Array.isArray(selected) ? selected : [selected]).filter(Boolean).map((value) => {
                            const role = roles.find((r) => r.id === value);
                            return (
                              <Chip
                                key={value}
                                label={role ? presetLabel(role) : value}
                                size="small"
                                sx={{
                                  bgcolor: (t) => alpha(t.palette.primary.main, t.palette.mode === "dark" ? 0.22 : 0.12),
                                  color: "primary.main",
                                  fontWeight: 500,
                                  "& .MuiChip-deleteIcon": {
                                    color: "primary.main",
                                    "&:hover": { color: "primary.dark" },
                                  },
                                }}
                                onDelete={isRolePresetsEnabled ? undefined : () => handleRoleToggle(value)}
                              />
                            );
                          })}
                        </Box>
                      )}
                      MenuProps={{
                        // Width is pinned to the field: the descriptions are a
                        // sentence long, and without this the menu grew to ~600px
                        // and spilled out of the drawer over the page behind it
                        // (guru 2026-10-28).
                        anchorOrigin: { vertical: "bottom", horizontal: "left" },
                        transformOrigin: { vertical: "top", horizontal: "left" },
                        PaperProps: {
                          sx: {
                            bgcolor: "background.paper",
                            backgroundImage: "none",
                            border: 1,
                            borderColor: "divider",
                            maxHeight: 420,
                            // The drawer is 500 wide with p:3 → 452 of content.
                            maxWidth: { xs: "calc(100vw - 32px)", sm: 452 },
                            "& .MuiMenuItem-root": { whiteSpace: "normal", alignItems: "flex-start", py: 1 },
                          },
                        },
                      }}
                      sx={{
                        "& .MuiOutlinedInput-notchedOutline": { borderColor: "divider" },
                        "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: "primary.main" },
                        "&.Mui-focused .MuiOutlinedInput-notchedOutline": { borderColor: "primary.main" },
                        bgcolor: "background.paper",
                      }}
                    >
                      {visibleRoles.map((role) => (
                        <MenuItem key={role.id} value={role.id}>
                          <Box sx={{ minWidth: 0 }}>
                            <Typography variant="body2" sx={{ fontWeight: 600, color: "text.primary" }}>
                              {presetLabel(role)}
                            </Typography>
                            {role.description && (
                              <Typography variant="caption" sx={{ color: "text.secondary", display: "block", lineHeight: 1.4 }}>
                                {presetSummary(role)}
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
            borderTop: 1,
            borderColor: "divider",
            bgcolor: "surfaceTones.low",
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
                  salesmanCode: "",
                  salesmanMobile: "",
                });
                setSelectedRoles([]);
                setShowPassword(false);
                setError("");
                  onClose();
                }}
              disabled={loading}
              color="inherit"
              >
                Cancel
              </Button>
            <Button
              type="submit"
              variant="contained"
              color="primary"
              disabled={loading}
              onClick={handleSubmit(onSubmit)}
            >
              {loading ? "Creating..." : "Create User"}
              </Button>
            </Box>
          </Box>
      </Box>
    </Drawer>
  );
}
