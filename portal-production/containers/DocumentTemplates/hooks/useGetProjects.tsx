/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useState, useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";

interface Project {
  id: string;
  name: string;
  description?: string;
  status: string;
  customerId?: string;
  customerName?: string;
  createdAt: string;
}

export const useGetProjects = (customerId?: string) => {
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProjects = async () => {
    if (!organization?.id) {
      setProjects([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const token = await getToken();
      if (!token) {
        setError("Authentication token is required");
        return;
      }

      // Build query params
      const params = new URLSearchParams({
        page: "1",
        limit: "100",
        organizationId: organization.id,
      });

      if (customerId) {
        params.append("customerId", customerId);
      }

      const response = await request(
        {
          path: `/projects?${params.toString()}`,
          method: "GET",
        },
        {},
        token
      );

      if (response.success) {
        setProjects(response.data?.docs || response.data || []);
      } else {
        setError(response.message || "Failed to fetch projects");
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "An error occurred while fetching projects";
      setError(errorMessage);
      console.error("Error fetching projects:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, [organization?.id, customerId]);

  return {
    projects,
    isLoading,
    error,
    refetch: fetchProjects,
  };
};