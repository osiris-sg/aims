"use client";

import { useState, useEffect } from "react";
import { useUser } from "@clerk/nextjs";
import { useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";

interface Organization {
  id: string;
  name: string;
}

export function useUserOrganization() {
  const { user } = useUser();
  const { getToken } = useAuth();
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchUserOrganization() {
      if (!user) {
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        setError(null);

        const token = await getToken();
        if (!token) {
          setError("Authentication token is required");
          setIsLoading(false);
          return;
        }

        // Call your backend to get the user's organization
        const response = await request(
          {
            path: "/organizations/user",
            method: "GET",
          },
          {},
          token
        );

        if (response.success && response.data) {
          setOrganization(response.data);
        } else {
          setError(response.message || "Failed to fetch user organization");
        }
      } catch (error) {
        console.error("Error fetching user organization:", error);
        setError("Failed to fetch user organization");
      } finally {
        setIsLoading(false);
      }
    }

    fetchUserOrganization();
  }, [user, getToken]);

  return {
    organization,
    isLoading,
    error,
  };
}
