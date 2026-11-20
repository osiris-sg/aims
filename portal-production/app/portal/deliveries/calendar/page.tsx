"use client";

// Jobs > Calendar (enableJobsCalendar orgs, the WCT group): the jobs calendar, the first Jobs tab
// and its default view (Elroy 2026-11-21). Same calendar as the Sales page, same API
// (GET /dashboard/jobs-calendar), which the server allows by the person's Calendar access.
import React from "react";
import { Alert } from "@mui/material";
import MainCard from "@/components/MainCard";
import JobsCalendar from "@/components/Dashboard/JobsCalendar";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import { useUserPermissions } from "@/app/portal/hooks/useUserPermissions";
import { calendarAllowed } from "@/helpers/customAccess";

export default function JobsCalendarPage() {
  const { isJobsCalendarEnabled, isLoading } = useOrganizationFeatures();
  const { customTabs, isLoading: rolesLoading } = useUserPermissions();
  if (isLoading || rolesLoading) return null;
  if (!isJobsCalendarEnabled || !calendarAllowed(customTabs)) {
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
