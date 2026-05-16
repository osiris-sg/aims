"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Box, CircularProgress } from "@mui/material";
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
  const { organization, isLoaded: orgLoaded } = useOrganization();
  const [checked, setChecked] = useState(false);
  const [allow, setAllow] = useState(false);

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
        if (cancelled) return;
        if (onlyFieldTech) {
          router.replace("/scan");
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

  if (!checked || !allow) {
    return (
      <Box sx={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <CircularProgress />
      </Box>
    );
  }

  return <>{children}</>;
}
