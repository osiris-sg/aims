"use client";

import React, { useEffect, useState } from "react";
import { Drawer, Box, Typography, TextField, Button, CircularProgress, Divider, Alert } from "@mui/material";
import { useAuth } from "@clerk/nextjs";
import PermissionCheckbox from "./PermissionsCheckbox";
import { useGetPermissions } from "../hooks/useGetPermissions";

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

interface Props {
  open: boolean;
  onClose: () => void;
  role: any;
  onRoleUpdated?: () => void;
}

export default function EditRole({ open, onClose, role, onRoleUpdated }: Props) {
  const { getToken } = useAuth();
  const { permissions, loading: permissionsLoading, error: permissionsError } = useGetPermissions();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);

  useEffect(() => {
    if (open && role) {
      setError(null);

      // Set form values from role
      setName(role.name || "");
      setDescription(role.description || "");

      // Set selected permissions based on the role
      if (role.permissions) {
        const permissionIds = role.permissions.map((p: any) => p.id);
        setSelectedPermissions(permissionIds);
      } else {
        setSelectedPermissions([]);
      }
    }
  }, [open, role]);

  // Handle permissions error
  useEffect(() => {
    if (permissionsError) {
      setError(permissionsError);
    }
  }, [permissionsError]);

  const handleTogglePermission = (permissionId: string) => {
    setSelectedPermissions((prev) => {
      if (prev.includes(permissionId)) {
        return prev.filter((id) => id !== permissionId);
      } else {
        return [...prev, permissionId];
      }
    });
  };

  const handleSave = async () => {
    if (!role || !name.trim()) {
      setError("Role name is required");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const token = await getToken();
      if (!token) {
        throw new Error("No authentication token available");
      }

      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}/roles/${role.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          permissionIds: selectedPermissions,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to update role");
      }

      if (onRoleUpdated) {
        onRoleUpdated();
      }
      onClose();
    } catch (error: any) {
      console.error("Error updating role:", error);
      setError(error.message || "Failed to update role");
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (!saving) {
      setError(null);
      onClose();
    }
  };

  // Create the grouped permissions
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
    <Drawer anchor="right" open={open} onClose={handleClose}>
      <Box sx={{ width: 500, p: 3, height: "100%", display: "flex", flexDirection: "column", backgroundColor: "background.paper" }}>
        <Typography variant="h5" sx={{ mb: 2 }}>
          Edit Role
        </Typography>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Update role details and assign permissions.
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {/* Role Details Form */}
        <Box sx={{ mb: 3 }}>
          <TextField fullWidth label="Role Name" value={name} onChange={(e) => setName(e.target.value)} disabled={saving} required sx={{ mb: 2 }} />

          <TextField fullWidth label="Description" value={description} onChange={(e) => setDescription(e.target.value)} disabled={saving} multiline rows={2} sx={{ mb: 2 }} />
        </Box>

        <Divider sx={{ mb: 2 }} />

        <Typography variant="h6" sx={{ mb: 2 }}>
          Permissions
        </Typography>

        {permissionsLoading ? (
          <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", flexGrow: 1 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Box sx={{ flexGrow: 1, overflow: "auto", mb: 3 }}>
            {Object.keys(groupedPermissions).length === 0 ? (
              <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: 200, flexDirection: "column" }}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  {permissionsError ? "Failed to load permissions" : "No permissions available"}
                </Typography>
                {permissionsError && (
                  <Button variant="outlined" size="small" onClick={() => window.location.reload()}>
                    Reload Page
                  </Button>
                )}
              </Box>
            ) : (
              Object.entries(groupedPermissions).map(([resource, perms]) => (
                <Box key={resource} sx={{ mb: 3 }}>
                  <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: "bold", textTransform: "capitalize" }}>
                    {resource}
                  </Typography>
                  <Divider sx={{ mb: 2 }} />

                  <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                    {perms.map((permission) => (
                      <PermissionCheckbox key={permission.id} permission={permission} checked={selectedPermissions.includes(permission.id)} onChange={() => handleTogglePermission(permission.id)} disabled={saving} />
                    ))}
                  </Box>
                </Box>
              ))
            )}
          </Box>
        )}

        {/* Action Buttons */}
        <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 2, pt: 2, borderTop: "1px solid", borderColor: "divider" }}>
          <Button variant="outlined" onClick={handleClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="contained" color="primary" onClick={handleSave} disabled={permissionsLoading || saving || !name.trim()}>
            {saving ? <CircularProgress size={24} /> : "Save Changes"}
          </Button>
        </Box>
      </Box>
    </Drawer>
  );
}
