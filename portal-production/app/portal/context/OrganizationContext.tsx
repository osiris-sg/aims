"use client";

import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
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

function useOrganizationFetcher(enabled: boolean): OrganizationContextType {
  const { user, isLoaded: isUserLoaded } = useUser();
  const { getToken } = useAuth();
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Track which user's org we successfully fetched, so we re-fetch on
  // account switch and retry on failure within the same session.
  const fetchedForUserId = useRef<string | null>(null);

  const fetchUserOrganization = useCallback(async () => {
    if (!enabled) return;
    if (!isUserLoaded) return;

    if (!user) {
      fetchedForUserId.current = null;
      setOrganization(null);
      setError(null);
      setIsLoaded(true);
      return;
    }

    if (fetchedForUserId.current === user.id) return;

    try {
      setError(null);
      const token = await getToken();
      if (!token) {
        setError("Authentication token is required");
        setIsLoaded(true);
        return;
      }

      const response = await request(
        { path: "/organizations/user", method: "GET" },
        {},
        token
      );

      if (response.success && response.data?.success && response.data.data) {
        setOrganization(response.data.data);
        fetchedForUserId.current = user.id;
      } else {
        setError(response.data?.message || response.message || "Failed to fetch user organization");
        setOrganization(null);
      }
    } catch (err) {
      console.error("Error fetching user organization:", err);
      setError("Failed to fetch user organization");
      setOrganization(null);
    } finally {
      setIsLoaded(true);
    }
  }, [enabled, isUserLoaded, user, getToken]);

  useEffect(() => {
    fetchUserOrganization();
  }, [fetchUserOrganization]);

  return { organization, isLoaded: enabled ? isLoaded : true, error };
}

export function OrganizationProvider({ children }: { children: React.ReactNode }) {
  const value = useOrganizationFetcher(true);
  return <OrganizationContext.Provider value={value}>{children}</OrganizationContext.Provider>;
}

export function useOrganization() {
  const context = useContext(OrganizationContext);
  // Call the fetcher unconditionally (Rules of Hooks) but only enable the
  // network fetch when no provider is present (e.g. standalone scan page).
  const fallback = useOrganizationFetcher(context === undefined);
  return context ?? fallback;
}
