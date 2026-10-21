import React, { useState, useEffect } from "react";
import { Box, Button, Drawer, Grid, Typography, FormControl, InputLabel, Select, MenuItem, Chip, Alert, IconButton, InputAdornment, TextField, Switch, FormControlLabel, Divider } from "@mui/material";

// WhatsApp shipments assistant (round S): per-user pushes. Mirrors the API defaults.
type WaPrefs = { digest: boolean; needsMe: boolean; filed: boolean; events: boolean; quietFrom: string; quietTo: string; lang: "en" | "ja" };
const WA_DEFAULTS: WaPrefs = { digest: true, needsMe: true, filed: false, events: true, quietFrom: "21:00", quietTo: "08:00", lang: "en" };
const waPrefsOf = (v: any): WaPrefs => ({ ...WA_DEFAULTS, ...(v && typeof v === "object" ? v : {}) });
import { useForm } from "react-hook-form";
import FormInputBox from "@/form-components/FormInputBox";
import { request } from "@/helpers/request";
import { useAuth } from "@clerk/nextjs";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import PersonIcon from "@mui/icons-material/Person";

interface Props {
  open: boolean;
  onClose: () => void;
  onUserUpdated?: () => void;
  user: any;
}

interface Role {
  id: string;
  name: string;
  description: string;
}

export default function EditUser({ open, onClose, onUserUpdated, user }: Props) {
  const { getToken } = useAuth();
  const [roles, setRoles] = useState<Role[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  // Org-scoped member profile (not Clerk): WhatsApp number for the agent's
  // sender matching + the designer's default commission share.
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [waPrefs, setWaPrefs] = useState<WaPrefs>(WA_DEFAULTS);
  const [commissionPct, setCommissionPct] = useState("");
  const [yearlySalesTarget, setYearlySalesTarget] = useState("");

  const {
    control,
    handleSubmit,
    reset,
    setValue,
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

  // Populate form when user data is available
  useEffect(() => {
    if (user && open) {
      // Parse the name field to extract first and last name
      const nameParts = user.name?.split(" ") || [];
      const firstName = nameParts[0] || "";
      const lastName = nameParts.slice(1).join(" ") || "";

      setValue("firstName", firstName);
      setValue("lastName", lastName);
      setValue("email", user.email || "");
      setValue("password", ""); // Don't pre-fill password for security

      // Set selected roles
      const roleIds = user.roles?.map((role: any) => role.id) || [];
      setSelectedRoles(roleIds);
      setWhatsappNumber(user.whatsappNumber || "");
      setWaPrefs(waPrefsOf(user.whatsappPrefs));
      setCommissionPct(user.commissionPct != null ? String(user.commissionPct) : "");
      setYearlySalesTarget(user.yearlySalesTarget != null ? String(user.yearlySalesTarget) : "");
    }
  }, [user, open, setValue]);

  const updateUser = async (userData: any) => {
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) {
        throw new Error("No authentication token available");
      }

      const response = await request(
        {
          method: "PATCH",
          path: `/users/${user.id}`,
        },
        userData,
        token
      );

      if (!response.success) {
        throw new Error(response.message || "Failed to update user");
      }

      return response;
    } catch (error) {
      console.error("Error updating user:", error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = async (data: any) => {
    if (selectedRoles.length === 0) {
      setError("Please select at least one role");
      return;
    }

    setError("");
    try {
      const updateData: any = {
        roleIds: selectedRoles,
      };

      // Only include fields that have values and are not empty
      if (data.firstName && data.firstName.trim()) {
        updateData.firstName = data.firstName.trim();
      }

      if (data.lastName && data.lastName.trim()) {
        updateData.lastName = data.lastName.trim();
      }

      if (data.email && data.email.trim()) {
        updateData.email = data.email.trim();
      }

      // Only include password if it's provided and not empty
      if (data.password && data.password.trim()) {
        updateData.password = data.password.trim();
      }

      console.log("Sending update data:", updateData);
      await updateUser(updateData);

      // Org member profile (WhatsApp number + default commission) — separate
      // endpoint because these live per-org, not in Clerk.
      try {
        const token = await getToken();
        await request(
          { method: "PATCH", path: `/users/${user.id}/profile` },
          { whatsappNumber: whatsappNumber.trim() || null, whatsappPrefs: waPrefs, commissionPct: commissionPct.trim() === "" ? null : Number(commissionPct), yearlySalesTarget: yearlySalesTarget.trim() === "" ? null : Number(yearlySalesTarget) },
          token ?? undefined
        );
      } catch (profileErr) {
        console.error("Profile update failed:", profileErr);
      }

      // Reset form and close drawer after successful update
      reset();
      setSelectedRoles([]);
      setShowPassword(false);
      onClose();

      // Call the callback to refresh the users list
      if (onUserUpdated) {
        onUserUpdated();
      }
    } catch (error: any) {
      setError(error.message || "Failed to update user");
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
            <PersonIcon sx={{ color: "#1976d2", fontSize: "1.75rem" }} />
            <Typography
              variant="h5"
              sx={{
                color: "#1a1a1a",
                fontWeight: 600,
                fontSize: "1.5rem",
              }}
            >
              Edit User
            </Typography>
          </Box>
          <Typography variant="body2" sx={{ color: "#666666" }}>
            Update user information, email, password, and role assignments
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

                <Grid item xs={6}>
                  <TextField
                    label="WhatsApp Number"
                    fullWidth
                    size="small"
                    value={whatsappNumber}
                    onChange={(e) => setWhatsappNumber(e.target.value)}
                    placeholder="e.g. 819012345678"
                    helperText="Digits with country code. Only linked numbers get answers; clear it to unlink."
                    inputProps={{ inputMode: "tel" }}
                    data-tour="user-whatsapp-number"
                  />
                </Grid>
                <Grid item xs={12}>
                  <Divider sx={{ my: 1 }} />
                  <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                    WhatsApp notifications
                  </Typography>
                  <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
                    Pushed to the number above (shipments assistant). Batched within 10 minutes, never in quiet hours (Japan time).
                  </Typography>
                  <Box sx={{ display: "flex", flexWrap: "wrap", columnGap: 2 }} data-tour="user-whatsapp-prefs">
                    <FormControlLabel control={<Switch size="small" checked={waPrefs.digest} onChange={(e) => setWaPrefs({ ...waPrefs, digest: e.target.checked })} />} label="Morning digest (08:30)" />
                    <FormControlLabel control={<Switch size="small" checked={waPrefs.needsMe} onChange={(e) => setWaPrefs({ ...waPrefs, needsMe: e.target.checked })} />} label="Needs you (an email waits for a decision)" />
                    <FormControlLabel control={<Switch size="small" checked={waPrefs.events} onChange={(e) => setWaPrefs({ ...waPrefs, events: e.target.checked })} />} label="Events (ETA changed, AN / permit filed, free time, stuck step)" />
                    <FormControlLabel control={<Switch size="small" checked={waPrefs.filed} onChange={(e) => setWaPrefs({ ...waPrefs, filed: e.target.checked })} />} label="Every auto-filed document (the digest covers it)" />
                  </Box>
                  <Grid container spacing={2} sx={{ mt: 0 }}>
                    <Grid item xs={4}>
                      <TextField label="Quiet from" type="time" size="small" fullWidth value={waPrefs.quietFrom} onChange={(e) => setWaPrefs({ ...waPrefs, quietFrom: e.target.value || "21:00" })} InputLabelProps={{ shrink: true }} />
                    </Grid>
                    <Grid item xs={4}>
                      <TextField label="Quiet to" type="time" size="small" fullWidth value={waPrefs.quietTo} onChange={(e) => setWaPrefs({ ...waPrefs, quietTo: e.target.value || "08:00" })} InputLabelProps={{ shrink: true }} />
                    </Grid>
                    <Grid item xs={4}>
                      <FormControl fullWidth size="small">
                        <InputLabel id="wa-lang">Digest language</InputLabel>
                        <Select labelId="wa-lang" label="Digest language" value={waPrefs.lang} onChange={(e) => setWaPrefs({ ...waPrefs, lang: e.target.value === "ja" ? "ja" : "en" })}>
                          <MenuItem value="en">English</MenuItem>
                          <MenuItem value="ja">日本語</MenuItem>
                        </Select>
                      </FormControl>
                    </Grid>
                  </Grid>
                </Grid>
                <Grid item xs={6}>
                  <TextField
                    label="Default Commission %"
                    fullWidth
                    size="small"
                    value={commissionPct}
                    onChange={(e) => setCommissionPct(e.target.value)}
                    placeholder="e.g. 50"
                    helperText="Applied to new projects they run"
                    inputProps={{ inputMode: "decimal" }}
                  />
                </Grid>

                <Grid item xs={6}>
                  <TextField
                    label="Yearly Sales Target (S$)"
                    fullWidth
                    size="small"
                    value={yearlySalesTarget}
                    onChange={(e) => setYearlySalesTarget(e.target.value)}
                    placeholder="e.g. 500000"
                    helperText="Contract value signed per year — drives the dashboard target bar"
                    inputProps={{ inputMode: "decimal" }}
                  />
                </Grid>

                <Grid item xs={12}>
                  <FormInputBox
                    label="Password (Leave blank to keep current)"
                    control={control}
                    name="password"
                    type={showPassword ? "text" : "password"}
                    placeHolder="Enter new password"
                    rules={{
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
                  <FormControl fullWidth>
                    <InputLabel id="edit-roles-label" sx={{ color: "#666666" }}>
                      Select Roles
                    </InputLabel>
                    <Select
                      labelId="edit-roles-label"
                      id="edit-roles"
                      label="Select Roles"
                      multiple
                      value={selectedRoles}
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
                            bgcolor: "background.paper",
                            color: "#222",
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
                        bgcolor: "background.paper",
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
                reset();
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
              {loading ? "Updating..." : "Update User"}
            </Button>
          </Box>
        </Box>
      </Box>
    </Drawer>
  );
}
