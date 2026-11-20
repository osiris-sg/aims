"use client";

// Dashboard "Today's jobs" (jobs calendar orgs, the WCT group; Elroy 2026-11-21): a small card with
// today's jobs (time, icons, customer; at most 6, then "+N more") and "View calendar", which opens
// Jobs > Calendar. Same data as the calendar (GET /dashboard/jobs-calendar for today).
import * as React from "react";
import { Box, Button, ButtonBase, Skeleton, Stack, Typography } from "@mui/material";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { request } from "@/helpers/request";
import { unwrap } from "@/app/portal/admin/organizations/_lib/siteclock-connection";
import { withoutSiteClockJobs, type CalendarPayload } from "./jobs-calendar/calendarModel";
import { todayIso } from "@/helpers/orgToday";
import { todaysJobs, type TodayRow } from "@/helpers/todaysJobs";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import { useUserPermissions } from "@/app/portal/hooks/useUserPermissions";
import { calendarAllowed } from "@/helpers/customAccess";

export const CALENDAR_PATH = "/portal/deliveries/calendar";

export default function TodaysJobsCard({ sx }: { sx?: Record<string, unknown> }) {
  const { isJobsCalendarEnabled, isHideSiteClockJobs } = useOrganizationFeatures();
  const { customTabs, isLoading } = useUserPermissions();
  const show = !!isJobsCalendarEnabled && !isLoading && calendarAllowed(customTabs);
  const { getToken } = useAuth();
  const router = useRouter();
  const [state, setState] = React.useState<{ rows: TodayRow[]; more: number } | null>(null);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    if (!show) return;
    let alive = true;
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const day = todayIso();
        const res = await request({ path: `/dashboard/jobs-calendar?from=${day}&to=${day}`, method: "GET", ownError: true }, undefined, token);
        const payload = unwrap<CalendarPayload>(res, "Couldn't load today's jobs");
        if (!alive) return;
        setState(todaysJobs(payload ? withoutSiteClockJobs(payload, !!isHideSiteClockJobs).events : []));
        setError("");
      } catch (e: any) {
        if (alive) setError(e?.message || "Couldn't load today's jobs");
      }
    })();
    return () => {
      alive = false;
    };
  }, [show, getToken, isHideSiteClockJobs]);

  if (!show) return null;
  return (
    <Box sx={{ p: { xs: 2, md: 2.5 }, ...sx }} data-testid="role-home-todays-jobs">
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography sx={{ fontSize: 18, fontWeight: 600 }}>{"Today's jobs"}</Typography>
        <Button size="small" onClick={() => router.push(CALENDAR_PATH)} data-testid="role-home-view-calendar">
          View calendar
        </Button>
      </Stack>
      {error ? (
        <Typography variant="body2" color="error">{error}</Typography>
      ) : !state ? (
        <Stack gap={1}>{[0, 1, 2].map((i) => <Skeleton key={i} height={24} />)}</Stack>
      ) : state.rows.length === 0 ? (
        <Typography variant="body2" sx={{ color: "text.secondary" }}>No jobs today</Typography>
      ) : (
        <Stack gap={0.25}>
          {state.rows.map((r) => (
            <ButtonBase
              key={r.id}
              disabled={!r.href}
              onClick={() => r.href && router.push(r.href)}
              sx={{ justifyContent: "flex-start", textAlign: "left", borderRadius: 1.5, px: 1, py: 0.75, gap: 1, "&:hover": { bgcolor: "action.hover" } }}
            >
              <Typography variant="body2" sx={{ color: "text.secondary", minWidth: 52, flexShrink: 0 }}>{r.time || "All day"}</Typography>
              {r.icons ? <Typography variant="body2" sx={{ flexShrink: 0 }}>{r.icons}</Typography> : null}
              <Typography variant="body2" noWrap sx={{ fontWeight: 500, minWidth: 0 }}>{r.customer}</Typography>
            </ButtonBase>
          ))}
          {state.more > 0 ? (
            <ButtonBase onClick={() => router.push(CALENDAR_PATH)} sx={{ justifyContent: "flex-start", px: 1, py: 0.5, borderRadius: 1.5 }}>
              <Typography variant="body2" sx={{ color: "text.secondary" }}>+{state.more} more</Typography>
            </ButtonBase>
          ) : null}
        </Stack>
      )}
    </Box>
  );
}
