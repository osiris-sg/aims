"use client";

import { useState, useEffect } from "react";
import { useUser } from "@clerk/nextjs";
import { useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";
import { rolesAllowModule, rolesHavePermission } from "@/helpers/multiRole";

interface Permission {
  id: string;
  name: string;
  resource: string;
  action: string;
}

interface Role {
  id: string;
  name: string;
  permissions: Permission[];
  allowedModules?: string[];
}

export function useUserPermissions() {
  const { user } = useUser();
  const { getToken } = useAuth();
  const [userRoles, setUserRoles] = useState<Role[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchUserRoles() {
      if (!user) {
        setIsLoading(false);
        return;
      }

      try {
        setError(null);
        const token = await getToken();
        if (!token) {
          setError("Authentication token is required");
          setIsLoading(false);
          return;
        }

        const response = await request(
          {
            path: `/users/me/roles`,
            method: "GET",
            quiet: true,
          },
          {},
          token
        );

        if (response.success) {
          setUserRoles(response.data || []);
        } else {
          setError(response.message || "Failed to fetch user roles");
        }
      } catch (error) {
        console.error("Error fetching user roles:", error);
        setError("Failed to fetch user roles");
      } finally {
        setIsLoading(false);
      }
    }

    fetchUserRoles();
  }, [user, getToken]);

  const canManageOrganizations = () => {
    return userRoles.some((role) => role.permissions.some((permission) => permission.resource === "organizations" && (permission.action === "manage" || permission.action === "*")));
  };

  // The union of the user's roles (helpers/multiRole.ts; same rule for every org).
  const hasPermission = (resource: string, action: string) => rolesHavePermission(userRoles, resource, action);

  // No roles, or any role with an empty allowedModules (e.g. Management), opens every
  // module; otherwise a module is allowed if any role grants it.
  const isModuleAllowed = (moduleCode: string) => rolesAllowModule(userRoles, moduleCode);

  return {
    userRoles,
    isLoading,
    error,
    canManageOrganizations,
    hasPermission,
    isModuleAllowed,
  };
}
