"use client";

import { useState, useEffect } from "react";
import { useUser } from "@clerk/nextjs";
import { useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";

interface Organization {
  id: string;
  name: string;
}

// This hook mimics Clerk's useOrganization but fetches from our backend
export function useOrganization() {
  const { user } = useUser();
  const { getToken } = useAuth();
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchUserOrganization() {
      if (!user) {
        setIsLoaded(true);
        return;
      }

      try {
        setError(null);

        const token = await getToken();
        if (!token) {
          setError("Authentication token is required");
          setIsLoaded(true);
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

        console.log("response for user org", response);

        if (response.success && response.data?.success && response.data.data) {
          setOrganization(response.data.data);
        } else {
          setError(response.data?.message || response.message || "Failed to fetch user organization");
          setOrganization(null);
        }
      } catch (error) {
        console.error("Error fetching user organization:", error);
        setError("Failed to fetch user organization");
        setOrganization(null);
      } finally {
        setIsLoaded(true);
      }
    }

    fetchUserOrganization();
  }, [user, getToken]);

  return {
    organization,
    isLoaded,
    error,
  };
}
