"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Alert, Box, Button, CircularProgress } from "@mui/material";
import { useClerk } from "@clerk/nextjs";
import { request } from "@/helpers/request";
import { useOrganization } from "../hooks/useOrganization";

/**
 * Locks `field-tech`-only users out of the portal.
 *
 * If the signed-in user has the `field-tech` role and no other roles in the
 * current org, we replace the URL with /scan immediately. Otherwise we render
 * the children (the rest of the portal) as normal.
 *
 * Mounted once at the top of app/portal/layout.tsx.
 */
export default function FieldOnlyGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { getToken } = useAuth();
  const { organization, isLoaded: orgLoaded, error: orgError, noOrganization } = useOrganization();
  const { signOut } = useClerk();
  const [checked, setChecked] = useState(false);
  const [allow, setAllow] = useState(false);

  // Valid Clerk session, no AIMS membership (the "not assigned to any
  // organization" 403 — e.g. a SiteClock-only user, since both apps share one
  // Clerk instance): their page is /no-account, outside /portal so this guard
  // and the org provider never run there.
  useEffect(() => {
    if (orgLoaded && noOrganization) router.replace("/no-account");
  }, [orgLoaded, noOrganization, router]);

  useEffect(() => {
    if (!orgLoaded || !organization?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) {
          if (!cancelled) {
            setChecked(true);
            setAllow(true);
          }
          return;
        }
        const res = await request({ path: "/users/me/roles", method: "GET" }, {}, token);
        const roles = (res.data ?? res ?? []) as Array<{ name: string }>;
        const names = roles.map((r) => (r?.name ?? "").toLowerCase());
        const onlyFieldTech = names.length > 0 && names.every((n) => n === "field-tech");
        const onlyNormalUser = names.length > 0 && names.every((n) => n === "normal_user");
        if (cancelled) return;
        if (onlyFieldTech) {
          router.replace("/scan");
        } else if (onlyNormalUser) {
          // Document-submit-only user: their entire app is /submit.
          router.replace("/submit");
        } else {
          setAllow(true);
        }
      } catch {
        if (!cancelled) setAllow(true); // fail-open: don't lock people out on a transient error
      } finally {
        if (!cancelled) setChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgLoaded, organization?.id, getToken, router]);

  // The org load finished without an org for some OTHER reason (token
  // missing, backend down): the roles effect never runs, so show the reason
  // instead of spinning forever. (The no-membership case redirects above and
  // keeps the spinner for the moment it takes.)
  if (orgLoaded && !organization?.id && orgError && !noOrganization) {
    return (
      <Box sx={{ minHeight: "100vh", width: "100%", flex: 1, display: "flex", alignItems: "center", justifyContent: "center", p: 2 }}>
        <Alert
          severity="warning"
          sx={{ maxWidth: 520 }}
          action={
            <Button color="inherit" size="small" sx={{ whiteSpace: "nowrap" }} onClick={() => signOut({ redirectUrl: "/sign-in" })}>
              Sign out
            </Button>
          }
        >
          {orgError}
        </Alert>
      </Box>
    );
  }

  if (!checked || !allow) {
    return (
      // width/flex so the spinner centers even when this renders as a flex
      // item beside the sidebar (it used to sit hard-left on reload).
      <Box sx={{ minHeight: "100vh", width: "100%", flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <CircularProgress />
      </Box>
    );
  }

  return <>{children}</>;
}
