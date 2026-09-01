"use client";

import { useState, useEffect } from "react";
import { useUser } from "@clerk/nextjs";
import { useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";

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

  const hasPermission = (resource: string, action: string) => {
    return userRoles.some((role) => role.permissions.some((permission) => (permission.resource === resource || permission.resource === "*") && (permission.action === action || permission.action === "*")));
  };

  const isModuleAllowed = (moduleCode: string) => {
    // If user has no roles, allow all (fallback)
    if (userRoles.length === 0) return true;

    // An empty allowedModules means the role grants ALL modules — so a user
    // holding any unrestricted role (e.g. Management) sees everything, even if
    // another of their roles (e.g. Designer) carries a restricted list.
    if (userRoles.some((role) => (role.allowedModules ?? []).length === 0)) return true;

    // Every role is restricted → module is allowed if any role grants it
    const allAllowed = userRoles.flatMap((role) => role.allowedModules ?? []);

    // Module is allowed if any role grants it
    return allAllowed.includes(moduleCode);
  };

  return {
    userRoles,
    isLoading,
    error,
    canManageOrganizations,
    hasPermission,
    isModuleAllowed,
  };
}
