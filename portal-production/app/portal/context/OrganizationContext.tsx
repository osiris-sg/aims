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
  // The org whose data is currently being viewed. Equals realOrganization
  // unless the user is an osiris-admin who has picked a different org in the
  // org switcher. Use this for org-scoped data fetches.
  organization: Organization | null;
  // The user's actual membership organization. Never changes during a session
  // regardless of switcher selection. Use this for admin gating, "Reset to
  // home" UX, etc.
  realOrganization: Organization | null;
  // True iff the user's real membership is the osiris-platform org.
  isOsirisAdmin: boolean;
  // The org id stored in sessionStorage. Non-null only when admin has actively
  // selected a different org. Cleared when picking "home".
  activeOrgId: string | null;
  // Setter that updates sessionStorage and reloads the page so every cache,
  // saga, and react-query store is rebuilt against the new org.
  setActiveOrgId: (id: string | null) => void;
  isLoaded: boolean;
  error: string | null;
}

const STORAGE_KEY = "aims-admin-active-org";
const ADMIN_ORG_NAME = "osiris-platform";

const OrganizationContext = createContext<OrganizationContextType | undefined>(undefined);

function readStoredOrgId(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(STORAGE_KEY);
}

function useOrganizationFetcher(enabled: boolean): OrganizationContextType {
  const { user, isLoaded: isUserLoaded } = useUser();
  const { getToken } = useAuth();
  const [realOrganization, setRealOrganization] = useState<Organization | null>(null);
  const [activeOrganization, setActiveOrganization] = useState<Organization | null>(null);
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
      setRealOrganization(null);
      setActiveOrganization(null);
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

      // Bootstrap: learn the REAL membership org regardless of any switch
      // override in sessionStorage. X-Use-Real-Org tells the backend guard
      // to skip the X-Active-Org-Id override for this single call.
      const realResponse = await request(
        { path: "/organizations/user", method: "GET" },
        {},
        token,
        { "X-Use-Real-Org": "1" },
      );

      const realOrg: Organization | null =
        realResponse?.success && realResponse?.data?.success && realResponse.data.data
          ? realResponse.data.data
          : null;

      if (!realOrg) {
        setError(
          realResponse?.data?.message ||
            realResponse?.message ||
            "Failed to fetch user organization",
        );
        setRealOrganization(null);
        setActiveOrganization(null);
        setIsLoaded(true);
        return;
      }

      setRealOrganization(realOrg);
      fetchedForUserId.current = user.id;

      const userIsAdmin = realOrg.name === ADMIN_ORG_NAME;
      const storedId = readStoredOrgId();

      // Non-admins: clear any stale sessionStorage value, never override.
      if (!userIsAdmin) {
        if (storedId && typeof window !== "undefined") {
          window.sessionStorage.removeItem(STORAGE_KEY);
        }
        setActiveOrganization(null);
      } else if (storedId && storedId !== realOrg.id) {
        // Admin has actively picked a different org — fetch its details from
        // the org list. The /organizations endpoint is permission-gated by
        // organizations:read; osiris-admins bypass permission checks at the
        // guard so this always works for them.
        const listResponse = await request(
          { path: "/organizations", method: "GET" },
          {},
          token,
        );
        const list: Organization[] =
          (listResponse?.success &&
            Array.isArray(listResponse?.data?.data) &&
            listResponse.data.data) ||
          (listResponse?.success && Array.isArray(listResponse?.data) && listResponse.data) ||
          [];
        const match = list.find((o) => o.id === storedId) ?? null;
        if (match) {
          setActiveOrganization(match);
        } else {
          // Stored id is stale (org deleted / not visible) — drop it.
          if (typeof window !== "undefined") window.sessionStorage.removeItem(STORAGE_KEY);
          setActiveOrganization(null);
        }
      } else {
        // Admin with no override (or override === real org): use the real org.
        if (storedId === realOrg.id && typeof window !== "undefined") {
          window.sessionStorage.removeItem(STORAGE_KEY);
        }
        setActiveOrganization(null);
      }
    } catch (err) {
      console.error("Error fetching user organization:", err);
      setError("Failed to fetch user organization");
      setRealOrganization(null);
      setActiveOrganization(null);
    } finally {
      setIsLoaded(true);
    }
  }, [enabled, isUserLoaded, user, getToken]);

  useEffect(() => {
    fetchUserOrganization();
  }, [fetchUserOrganization]);

  const setActiveOrgId = useCallback((id: string | null) => {
    if (typeof window === "undefined") return;
    if (id) {
      window.sessionStorage.setItem(STORAGE_KEY, id);
    } else {
      window.sessionStorage.removeItem(STORAGE_KEY);
    }
    // Full reload — every Redux/saga/React-Query cache is org-scoped and
    // invalidating in place is significantly more code (and easy to miss a
    // place). A reload is one line and guaranteed consistent.
    window.location.reload();
  }, []);

  const isOsirisAdmin = realOrganization?.name === ADMIN_ORG_NAME;
  const organization = activeOrganization ?? realOrganization;
  const activeOrgId =
    activeOrganization && realOrganization && activeOrganization.id !== realOrganization.id
      ? activeOrganization.id
      : null;

  return {
    organization,
    realOrganization,
    isOsirisAdmin,
    activeOrgId,
    setActiveOrgId,
    isLoaded: enabled ? isLoaded : true,
    error,
  };
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
