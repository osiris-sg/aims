"use client";

// Jobs > Calendar (enableCustomAccess + enableJobsCalendar orgs, WCT group 2026-11-19): the jobs
// calendar the Sales main page shows, for people who have the Calendar but not Sales (e.g.
// Operations). Same calendar, same API (GET /dashboard/jobs-calendar), which the server allows by
// the person's Calendar access.
import React from "react";
import { Alert } from "@mui/material";
import MainCard from "@/components/MainCard";
import JobsCalendar from "@/components/Dashboard/JobsCalendar";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import { useUserPermissions } from "@/app/portal/hooks/useUserPermissions";
import { calendarAllowed } from "@/helpers/customAccess";

export default function JobsCalendarPage() {
  const { isJobsCalendarEnabled, isCustomAccessEnabled, isLoading } = useOrganizationFeatures();
  const { customTabs, isLoading: rolesLoading } = useUserPermissions();
  if (isLoading || rolesLoading) return null;
  if (!isJobsCalendarEnabled || !isCustomAccessEnabled || !calendarAllowed(customTabs)) {
    return (
      <MainCard>
        <Alert severity="info">The calendar is not available here.</Alert>
      </MainCard>
    );
  }
  return (
    <MainCard>
      <JobsCalendar fullHeight />
    </MainCard>
  );
}
