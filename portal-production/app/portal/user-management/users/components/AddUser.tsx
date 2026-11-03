import React, { useState, useEffect } from "react";
import { Box, Button, Drawer, Grid, Typography, FormControl, InputLabel, Select, MenuItem, Chip, Alert, IconButton, InputAdornment, Divider , alpha } from "@mui/material";
import { useForm } from "react-hook-form";
import FormInputBox from "@/form-components/FormInputBox";
import useAddUserStates from "../hooks/useAddUser";
import { request } from "@/helpers/request";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import { useAuth } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import { toast } from "react-toastify";
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
// Round AZ: the label text is users.form.fieldTech (English unchanged).
const PRESET_LABEL: Record<string, string> = { "field-tech": "fieldTech" };
const presetLabel = (r: { name: string; description?: string | null }, t: (key: string) => string) => (PRESET_LABEL[r.name] ? t(PRESET_LABEL[r.name]) : r.name);
const presetSummary = (r: { description?: string | null }) => {
  const d = String(r.description ?? "");
  const i = d.indexOf(" — ");
  return d.startsWith(PRESET_PREFIX) && i > 0 ? d.slice(i + 3) : d;
};
const isPresetRole = (r: { name: string; description?: string | null }) => r.name !== "superadmin" && String(r.description ?? "").startsWith(PRESET_PREFIX);

/** A Singapore mobile: 8 digits starting with 8 or 9 (spaces, dashes, a leading +65 / 65 are fine). The server checks again. */
export const isSgMobile = (v: string) => /^(?:\+?65)?[89]\d{7}$/.test(v.replace(/[\s\-().]/g, ""));

interface Role {
  id: string;
  name: string;
  description: string;
}

export default function AddUser({ open, onClose, onUserCreated }: Props) {
  const { createUser, loading } = useAddUserStates();
  const t = useTranslations("users.form");
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
      mobile: "",
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
      setError(t("selectOneRole"));
      return;
    }

    // At least one of email / mobile (owner 2026-11-03).
    if (!data.email?.trim() && !data.mobile?.trim()) {
      setError(t("needOne"));
      return;
    }

    setError("");
    try {
      const res: any = await createUser({
        firstName: data.firstName,
        lastName: data.lastName,
        ...(data.email?.trim() ? { email: data.email.trim() } : {}),
        ...(data.mobile?.trim() ? { phone: data.mobile.trim() } : {}),
        ...(data.password?.trim() ? { password: data.password.trim() } : {}),
        roleIds: selectedRoles,
        salesmanCode: data.salesmanCode || undefined,
        salesmanMobile: data.salesmanMobile || undefined,
      });

      // The one success text (the same whether or not they already had a login).
      toast.success(res?.data?.message ?? res?.message ?? t("added"));

      // Reset form and close drawer after successful creation
      reset({
        firstName: "",
        lastName: "",
        email: "",
        mobile: "",
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
      setError(error.message || t("createFailed"));
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
              {t("createTitle")}
            </Typography>
          </Box>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            {t("createSub")}
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
                    label={t("firstName")}
                    control={control}
                    name="firstName"
                    placeHolder={t("firstNamePh")}
                    rules={{
                      required: t("firstNameReq"),
                    }}
                    error={!!errors.firstName}
                    helperText={errors.firstName?.message as string}
                  />
                </Grid>

                <Grid item xs={6}>
                  <FormInputBox
                    label={t("lastName")}
                    control={control}
                    name="lastName"
                    placeHolder={t("lastNamePh")}
                    rules={{
                      required: t("lastNameReq"),
                    }}
                    error={!!errors.lastName}
                    helperText={errors.lastName?.message as string}
                  />
                </Grid>

                <Grid item xs={12}>
                  <FormInputBox
                    label={t("email")}
                    control={control}
                    name="email"
                    placeHolder={t("emailPh")}
                    rules={{
                      pattern: {
                        value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
                        message: t("emailInvalid"),
                      },
                    }}
                    error={!!errors.email}
                    helperText={errors.email?.message as string}
                  />
                </Grid>

              {/* Sign-in mobile (owner 2026-11-03): optional, at least one of email / mobile. */}
              <Grid item xs={12}>
                  <FormInputBox
                    label={t("mobile")}
                    control={control}
                    name="mobile"
                    startIcon={<Typography variant="body2" sx={{ color: "text.secondary" }}>+65</Typography>}
                    placeHolder={t("mobilePh")}
                    rules={{
                      validate: (v: string) => !v || isSgMobile(v) || t("mobileInvalid"),
                    }}
                    error={!!errors.mobile}
                    bottomText={t("mobileHelp")}
                  />
                </Grid>

              <Grid item xs={12}>
                  <FormInputBox
                    label={t("password")}
                    control={control}
                    name="password"
                    type={showPassword ? "text" : "password"}
                    placeHolder={t("passwordPh")}
                    rules={{
                      validate: (v: string) => !v || v.length >= 8 || t("passwordMin"),
                    }}
                    error={!!errors.password}
                    helperText={(errors.password?.message as string) || t("passwordHelp")}
                    bottomText={t("passwordHelp")}
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
                      {showPassword ? t("hidePassword") : t("showPassword")}
                    </Button>
                  </Box>
              </Grid>

              <Grid item xs={12}>
                  <FormInputBox
                    label={t("salesmanCode")}
                    control={control}
                    name="salesmanCode"
                    placeHolder={t("salesmanCodePh")}
                  />
                </Grid>

              {/* Their own contact number. Documents they raise stamp it into
                  the Salesman Mobile field automatically, so salespeople stop
                  retyping it on every quotation (Eve @ Biofuel, 2026-09-24). */}
              <Grid item xs={12}>
                  <FormInputBox
                    label={t("salesmanMobile")}
                    control={control}
                    name="salesmanMobile"
                    placeHolder={t("salesmanMobilePh")}
                  />
                </Grid>

              <Grid item xs={12}>
                  <FormControl fullWidth>
                    <InputLabel id="select-roles-label">
                      {isRolePresetsEnabled ? t("role") : t("selectRoles")}
                    </InputLabel>
                    <Select
                      labelId="select-roles-label"
                      id="select-roles"
                      label={isRolePresetsEnabled ? t("role") : t("selectRoles")}
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
                                label={role ? presetLabel(role, t) : value}
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
                              {presetLabel(role, t)}
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
                  mobile: "",
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
                {t("cancel")}
              </Button>
            <Button
              type="submit"
              variant="contained"
              color="primary"
              disabled={loading}
              onClick={handleSubmit(onSubmit)}
            >
              {loading ? t("creating") : t("create")}
              </Button>
            </Box>
          </Box>
      </Box>
    </Drawer>
  );
}
