"use client";

// Loads the org's Financial Settings time zone once per org so default dates
// (helpers/orgToday.todayIso) follow it. Renders nothing; a failed fetch (e.g.
// no accounting access) keeps the Asia/Singapore default.
import { useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import { setOrgTimeZone } from "@/helpers/orgToday";

export default function OrgTimeZoneLoader() {
  const { organization } = useOrganization();
  const { getToken } = useAuth();
  const orgId = organization?.id;
  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    setOrgTimeZone(null);
    (async () => {
      try {
        const token = await getToken();
        const res = await request({ path: "/accounting/settings", method: "GET" }, {}, token || undefined);
        const s = res?.data ?? res;
        if (!cancelled) setOrgTimeZone(s?.timeZone);
      } catch {
        // keep the default
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, getToken]);
  return null;
}
