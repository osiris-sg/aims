"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@clerk/nextjs";

interface Permission {
  id: string;
  name: string;
  description: string;
  resource: string;
  action: string;
}

export const useGetPermissions = () => {
  const { getToken } = useAuth();
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPermissions = async () => {
    setLoading(true);
    setError(null);

    try {
      const token = await getToken();
      if (!token) {
        throw new Error("No authentication token available");
      }

      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}/permissions`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch permissions");
      }

      const response_data = await response.json();

      // The API returns data wrapped in a success response
      const permissions_data = response_data.data || response_data;
      console.log('permissions_data:', permissions_data);
      setPermissions(Array.isArray(permissions_data) ? permissions_data : []);
    } catch (error: any) {
      console.error("Error fetching permissions:", error);
      setError(error.message || "Failed to fetch permissions");

      // Use mock data as fallback for development
      setPermissions(mockPermissions);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPermissions();
  }, []);

  return {
    permissions,
    loading,
    error,
    refetch: fetchPermissions,
  };
};

// Mock permissions data for development fallback
const mockPermissions: Permission[] = [
  { id: "1", name: "roles:create", description: "Can create roles", resource: "roles", action: "create" },
  { id: "2", name: "roles:read", description: "Can read roles", resource: "roles", action: "read" },
  { id: "3", name: "roles:update", description: "Can update roles", resource: "roles", action: "update" },
  { id: "4", name: "roles:delete", description: "Can delete roles", resource: "roles", action: "delete" },
  { id: "5", name: "permissions:create", description: "Can create permissions", resource: "permissions", action: "create" },
  { id: "6", name: "permissions:read", description: "Can read permissions", resource: "permissions", action: "read" },
  { id: "7", name: "permissions:update", description: "Can update permissions", resource: "permissions", action: "update" },
  { id: "8", name: "permissions:delete", description: "Can delete permissions", resource: "permissions", action: "delete" },
  { id: "9", name: "users:create", description: "Can create users", resource: "users", action: "create" },
  { id: "10", name: "users:read", description: "Can read users", resource: "users", action: "read" },
  { id: "11", name: "users:update", description: "Can update users", resource: "users", action: "update" },
  { id: "12", name: "users:delete", description: "Can delete users", resource: "users", action: "delete" },
  { id: "13", name: "assets:create", description: "Can create assets", resource: "assets", action: "create" },
  { id: "14", name: "assets:read", description: "Can read assets", resource: "assets", action: "read" },
  { id: "15", name: "assets:update", description: "Can update assets", resource: "assets", action: "update" },
  { id: "16", name: "assets:delete", description: "Can delete assets", resource: "assets", action: "delete" },
];
