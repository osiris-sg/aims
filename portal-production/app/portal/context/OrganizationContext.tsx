"use client";

import React, { createContext, useContext, useState, useEffect, useRef } from "react";
import { useUser } from "@clerk/nextjs";
import { useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";

interface Organization {
  id: string;
  name: string;
  address?: string | null;
  phoneNumber?: string | null;
  registrationNumber?: string | null;
  taxRate?: number | null;
  logo?: string | null;
  defaultStamp?: string | null;
  customDocumentTypes?: Record<string, string> | null;
  bankDetails?: {
    accountName?: string;
    accountNumber?: string;
    bankName?: string;
    swiftCode?: string;
    branchCode?: string;
    bankCode?: string;
    currencyCode?: string;
  } | null;
}

interface OrganizationContextType {
  organization: Organization | null;
  isLoaded: boolean;
  error: string | null;
}

const OrganizationContext = createContext<OrganizationContextType | undefined>(undefined);

export function OrganizationProvider({ children }: { children: React.ReactNode }) {
  const { user } = useUser();
  const { getToken } = useAuth();
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasFetched = useRef(false);

  useEffect(() => {
    async function fetchUserOrganization() {
      if (!user || hasFetched.current) {
        setIsLoaded(true);
        return;
      }

      try {
        setError(null);
        hasFetched.current = true;

        const token = await getToken();
        if (!token) {
          setError("Authentication token is required");
          setIsLoaded(true);
          return;
        }

        const response = await request(
          {
            path: "/organizations/user",
            method: "GET",
          },
          {},
          token
        );

        console.log("response for user org", response);
        console.log("response.success:", response.success);
        console.log("response.data:", response.data);
        console.log("response.data?.success:", response.data?.success);
        console.log("response.data?.data:", response.data?.data);

        if (response.success && response.data?.success && response.data.data) {
          console.log("Setting organization to:", response.data.data);
          setOrganization(response.data.data);
        } else {
          console.log("Failed to set organization. Error:", response.data?.message || response.message);
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
  }, [user]);

  return <OrganizationContext.Provider value={{ organization, isLoaded, error }}>{children}</OrganizationContext.Provider>;
}

export function useOrganization() {
  const context = useContext(OrganizationContext);

  // If context is available, use it (portal pages)
  if (context !== undefined) {
    return context;
  }

  // Fallback for pages outside portal layout (like scan page)
  const { user } = useUser();
  const { getToken } = useAuth();
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasFetched = useRef(false);

  useEffect(() => {
    async function fetchUserOrganization() {
      if (!user || hasFetched.current) {
        setIsLoaded(true);
        return;
      }

      try {
        setError(null);
        hasFetched.current = true;

        const token = await getToken();
        if (!token) {
          setError("Authentication token is required");
          setIsLoaded(true);
          return;
        }

        const response = await request(
          {
            path: "/organizations/user",
            method: "GET",
          },
          {},
          token
        );

        console.log("response for user org (fallback)", response);
        console.log("fallback - response.success:", response.success);
        console.log("fallback - response.data:", response.data);
        console.log("fallback - response.data?.success:", response.data?.success);
        console.log("fallback - response.data?.data:", response.data?.data);

        if (response.success && response.data?.success && response.data.data) {
          console.log("fallback - Setting organization to:", response.data.data);
          setOrganization(response.data.data);
        } else {
          console.log("fallback - Failed to set organization. Error:", response.data?.message || response.message);
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
  }, [user]);

  return { organization, isLoaded, error };
}
