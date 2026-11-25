"use client";

// Loads the org's Financial Settings time zone once per org so default dates
// (helpers/orgToday.todayIso) follow it, and the base currency + standing
// rates (helpers/orgFx) so editors price in the customer's currency. Renders nothing; a failed fetch (e.g.
// no accounting access) keeps the Asia/Singapore default.
import { useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import { setOrgTimeZone } from "@/helpers/orgToday";
import { setOrgFx } from "@/helpers/orgFx";

export default function OrgTimeZoneLoader() {
  const { organization } = useOrganization();
  const { getToken } = useAuth();
  const orgId = organization?.id;
  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    setOrgTimeZone(null);
    setOrgFx(null);
    (async () => {
      try {
        const token = await getToken();
        const res = await request({ path: "/accounting/settings", method: "GET", quiet: true }, {}, token || undefined);
        const s = res?.data ?? res;
        if (!cancelled) {
          setOrgTimeZone(s?.timeZone);
          // Base currency + standing rates for document editors (helpers/orgFx).
          setOrgFx(s);
        }
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
