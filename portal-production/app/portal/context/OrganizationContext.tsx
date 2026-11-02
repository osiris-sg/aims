"use client";

import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { useUser } from "@clerk/nextjs";
import { useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";
import { memberOverride } from "@/helpers/multiOrg";

interface Organization {
  id: string;
  name: string;
  address?: string | null;
  phoneNumber?: string | null;
  registrationNumber?: string | null;
  email?: string | null;
  website?: string | null;
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
    paynowUen?: string;
  } | null;
}

/** One of the signed-in user's organisations (GET /users/me/organizations). */
export interface Membership {
  id: string;
  name: string;
  logo?: string | null;
  roles: string[];
  unreadNotifications: number;
}

interface OrganizationContextType {
  // The org whose data is currently being viewed (this tab's org). Equals
  // realOrganization unless the user picked another org in the switcher: an
  // osiris-admin any org, a member of several orgs one of THEIR orgs.
  // Use this for org-scoped data fetches.
  organization: Organization | null;
  // The user's default organization (for a member of several orgs: the one
  // used most recently). Never changes during a session regardless of
  // switcher selection. Use this for "Reset to home" UX, etc.
  realOrganization: Organization | null;
  // The server's verdict: the osiris-platform org's osirisadmin role.
  isOsirisAdmin: boolean;
  // Every active organization of the user (default first). 2+ shows the org
  // switcher for members (multi-org users, 2026-11-02).
  memberships: Membership[];
  // The org id stored in sessionStorage. Non-null only when the user has
  // actively selected a different org. Cleared when picking "home".
  activeOrgId: string | null;
  // Setter that updates sessionStorage and does a FULL page load so every
  // cache, saga, and react-query store is rebuilt against the new org. By
  // default it lands on /portal (round Y: an org switch never keeps the
  // current URL — the page you were on may not exist for the new org);
  // `keepUrl: true` reloads the current URL instead (the module guard's
  // cross-org auto-switch uses it to keep a deep link).
  setActiveOrgId: (id: string | null, opts?: SetActiveOrgOptions) => void;
  isLoaded: boolean;
  error: string | null;
  // True when the backend answered the bootstrap with "User is not assigned
  // to any organization" (the ClerkAuthGuard 403, or the controller's
  // success:false twin). A valid Clerk session with no AIMS membership — e.g.
  // a SiteClock-only user, since both apps share one Clerk instance.
  // FieldOnlyGuard sends these users to /no-account.
  noOrganization: boolean;
}

export interface SetActiveOrgOptions {
  keepUrl?: boolean;
}

const STORAGE_KEY = "aims-admin-active-org";
/** Where an org switch lands: /portal routes trade orgs on to Sales › Dashboard. */
const SWITCH_LANDING = "/portal";
const NO_ORG_RE = /not assigned to any organi[sz]ation/i;
const ADMIN_ORG_NAME = "osiris-platform";

/** The payload of a { success, data } reply (the controller sometimes nests one more). */
const dataOf = (res: any) => (res?.success ? (res?.data?.success && "data" in res.data ? res.data.data : res.data) : null);

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
  const [noOrganization, setNoOrganization] = useState(false);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [serverIsAdmin, setServerIsAdmin] = useState<boolean | null>(null);
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
      setNoOrganization(false);
      setIsLoaded(true);
      return;
    }

    if (fetchedForUserId.current === user.id) return;

    try {
      setError(null);
      setNoOrganization(false);
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
        const message =
          realResponse?.data?.message ||
          realResponse?.message ||
          "Failed to fetch user organization";
        setError(message);
        setNoOrganization(
          NO_ORG_RE.test(String(message)) ||
            (realResponse?.details?.statusCode === 403 && NO_ORG_RE.test(String(realResponse?.details?.message ?? ""))),
        );
        setRealOrganization(null);
        setActiveOrganization(null);
        setIsLoaded(true);
        return;
      }

      setRealOrganization(realOrg);
      fetchedForUserId.current = user.id;

      // My organisations + the server's admin verdict (multi-org users). The
      // bootstrap header skips any stale stored org, which could be a 403 now.
      const mineRes = await request({ path: "/users/me/organizations", method: "GET" }, {}, token, { "X-Use-Real-Org": "1" });
      const mine = dataOf(mineRes);
      const list: Membership[] = Array.isArray(mine?.organizations) ? mine.organizations : [];
      setMemberships(list);
      const userIsAdmin = typeof mine?.isOsirisAdmin === "boolean" ? mine.isOsirisAdmin : realOrg.name === ADMIN_ORG_NAME;
      setServerIsAdmin(userIsAdmin);
      const storedId = readStoredOrgId();

      if (!userIsAdmin) {
        // A member: the stored org counts only if it is one of THEIR orgs.
        const pick = memberOverride(storedId, realOrg.id, list.map((m) => m.id));
        if (pick) {
          const sw = await request({ path: "/organizations/user", method: "GET" }, {}, token, { "X-Active-Org-Id": pick });
          const swOrg = dataOf(sw);
          if (swOrg?.id === pick) setActiveOrganization(swOrg);
          else {
            if (typeof window !== "undefined") window.sessionStorage.removeItem(STORAGE_KEY);
            setActiveOrganization(null);
          }
        } else {
          if (storedId && typeof window !== "undefined") window.sessionStorage.removeItem(STORAGE_KEY);
          setActiveOrganization(null);
        }
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

  // Self-heal on tab return: the org fetch runs ONCE per user (fetchedForUserId
  // guard) — if that single attempt died while the tab was waking (expired
  // Clerk token / suspended network), nothing ever retried and the whole app
  // sat on a spinner until a hard refresh. On visibility/focus, retry ONLY
  // when the last attempt didn't succeed (guard still prevents redundant
  // fetches after a good load).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (user && fetchedForUserId.current !== user.id) {
        fetchUserOrganization();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [user, fetchUserOrganization]);

  const setActiveOrgId = useCallback(async (id: string | null, opts?: SetActiveOrgOptions) => {
    if (typeof window === "undefined") return;
    // Remember the switch as the user's default org (most recently used) when
    // it is one of their own orgs. Best-effort: the switch itself never waits on it.
    const target = id ?? realOrganization?.id ?? null;
    if (target && memberships.some((m) => m.id === target)) {
      try {
        const token = await getToken();
        if (token) await request({ path: "/users/me/active-org", method: "POST" }, { organizationId: target }, token, { "X-Use-Real-Org": "1" });
      } catch {
        // ignore: the tab still switches
      }
    }
    if (id) {
      window.sessionStorage.setItem(STORAGE_KEY, id);
    } else {
      window.sessionStorage.removeItem(STORAGE_KEY);
    }
    // Full page load — every Redux/saga/React-Query cache is org-scoped and
    // invalidating in place is significantly more code (and easy to miss a
    // place). A full load is one line and guaranteed consistent. It lands on
    // /portal (the new org's home) unless the caller asks to keep the URL.
    if (opts?.keepUrl) {
      window.location.reload();
    } else {
      window.location.assign(SWITCH_LANDING);
    }
  }, [getToken, memberships, realOrganization?.id]);

  const isOsirisAdmin = serverIsAdmin ?? realOrganization?.name === ADMIN_ORG_NAME;
  const organization = activeOrganization ?? realOrganization;
  const activeOrgId =
    activeOrganization && realOrganization && activeOrganization.id !== realOrganization.id
      ? activeOrganization.id
      : null;

  return {
    organization,
    realOrganization,
    isOsirisAdmin,
    memberships,
    activeOrgId,
    setActiveOrgId,
    isLoaded: enabled ? isLoaded : true,
    error,
    noOrganization,
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
