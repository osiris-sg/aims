// /containers/Permissions/components/EditPermissions.tsx
import React, { useEffect, useState } from "react";
import { Box, Button, Drawer, Typography, Divider, CircularProgress } from "@mui/material";
import PermissionCheckbox from "./PermissionsCheckbox";

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
  onPermissionsUpdated?: () => void;
}

export default function EditPermissions({ open, onClose, role, onPermissionsUpdated }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);

  useEffect(() => {
    if (open && role) {
      const fetchPermissions = async () => {
        setLoading(true);
        try {
          // Replace with your API call
          const response = await fetch('/api/permissions');
          
          if (!response.ok) {
            throw new Error('Failed to fetch permissions');
          }
          
          const data = await response.json();
          setPermissions(data.permissions || mockPermissions);
          
          // Set selected permissions based on the role
          if (role.permissions) {
            const permissionIds = role.permissions.map((p: any) => p.id);
            setSelectedPermissions(permissionIds);
          }
        } catch (error) {
          console.error("Error fetching permissions:", error);
          // Use mock data for development
          setPermissions(mockPermissions);
          
          // Simulate selected permissions for development
          setSelectedPermissions(mockPermissions.slice(0, 5).map(p => p.id));
        } finally {
          setLoading(false);
        }
      };

      fetchPermissions();
    }
  }, [open, role]);

  const handleTogglePermission = (permissionId: string) => {
    setSelectedPermissions(prev => {
      if (prev.includes(permissionId)) {
        return prev.filter(id => id !== permissionId);
      } else {
        return [...prev, permissionId];
      }
    });
  };

  const handleSave = async () => {
    if (!role) return;
    
    setSaving(true);
    try {
      // Call your API to update role permissions
      const response = await fetch(`/api/roles/${role.id}/permissions`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ permissionIds: selectedPermissions }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to update permissions');
      }
      
      // Close drawer after successful update
    //   onClose();
    if (onPermissionsUpdated) {
        onPermissionsUpdated();
      } else {
        onClose();
      }
      // You might want to refresh the roles list here
    } catch (error) {
      console.error("Error updating permissions:", error);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  // Create the grouped permissions with proper typing
  const groupedPermissions: GroupedPermissions = permissions.reduce((acc: GroupedPermissions, permission) => {
    const resource = permission.resource;
    if (!acc[resource]) {
      acc[resource] = [];
    }
    acc[resource].push(permission);
    return acc;
  }, {});

  return (
    <Drawer anchor="right" open={open} onClose={onClose}>
      <Box sx={{ width: 500, p: 3, height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: 'white'}}>
        <Typography variant="h5" sx={{ mb: 2 }}>
          Edit Permissions: {role?.name}
        </Typography>
        
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Select the permissions to assign to this role.
        </Typography>
        
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flexGrow: 1 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Box sx={{ flexGrow: 1, overflow: 'auto', mb: 3 }}>
            {Object.entries(groupedPermissions).map(([resource, perms]) => (
              <Box key={resource} sx={{ mb: 3 }}>
                <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 'bold', textTransform: 'capitalize' }}>
                  {resource}
                </Typography>
                <Divider sx={{ mb: 2 }} />
                
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {perms.map(permission => (
                    <PermissionCheckbox
                      key={permission.id}
                      permission={permission}
                      checked={selectedPermissions.includes(permission.id)}
                      onChange={() => handleTogglePermission(permission.id)}
                    />
                  ))}
                </Box>
              </Box>
            ))}
          </Box>
        )}
        
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
          <Button variant="outlined" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button 
            variant="contained" 
            color="primary" 
            onClick={handleSave}
            disabled={loading || saving}
          >
            {saving ? <CircularProgress size={24} /> : 'Save Changes'}
          </Button>
        </Box>
      </Box>
    </Drawer>
  );
}

// Mock permissions data for development
const mockPermissions: Permission[] = [
  { id: '1', name: 'roles:create', description: 'Can create roles', resource: 'roles', action: 'create' },
  { id: '2', name: 'roles:read', description: 'Can read roles', resource: 'roles', action: 'read' },
  { id: '3', name: 'roles:update', description: 'Can update roles', resource: 'roles', action: 'update' },
  { id: '4', name: 'roles:delete', description: 'Can delete roles', resource: 'roles', action: 'delete' },
  { id: '5', name: 'permissions:create', description: 'Can create permissions', resource: 'permissions', action: 'create' },
  { id: '6', name: 'permissions:read', description: 'Can read permissions', resource: 'permissions', action: 'read' },
  { id: '7', name: 'permissions:update', description: 'Can update permissions', resource: 'permissions', action: 'update' },
  { id: '8', name: 'permissions:delete', description: 'Can delete permissions', resource: 'permissions', action: 'delete' },
  { id: '9', name: 'users:assign-role', description: 'Can assign roles to users', resource: 'users', action: 'assign-role' },
  { id: '10', name: 'users:remove-role', description: 'Can remove roles from users', resource: 'users', action: 'remove-role' },
  { id: '11', name: 'users:read-roles', description: 'Can read user roles', resource: 'users', action: 'read-roles' },
  { id: '12', name: 'assets:read', description: 'Can read assets', resource: 'assets', action: 'read' },
  { id: '13', name: 'assets:create', description: 'Can create assets', resource: 'assets', action: 'create' },
  { id: '14', name: 'assets:update', description: 'Can update assets', resource: 'assets', action: 'update' },
  { id: '15', name: 'assets:delete', description: 'Can delete assets', resource: 'assets', action: 'delete' },
];