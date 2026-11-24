"use client";

// Jobs calendar loading skeleton (WCT group, 2026-11-25): until the org's settings and the first calendar data are in,
// the page shows the shape of the real calendar (filter row, toolbar, grid) instead of the plain calendar, which
// used to show first and then switch to the styled one (the "old calendar flash").

import React from "react";
import { Box, Skeleton, Stack } from "@mui/material";

/** The filter row: DO, PTW, Applicant, Organisation on the left; search, Export list, Settings on the right. */
export function FilterRowSkeleton() {
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }} data-testid="jc-skeleton-filters">
      {[140, 130, 140, 150].map((w, i) => (
        <Skeleton key={i} variant="rounded" width={w} height={40} />
      ))}
      <Box sx={{ flex: 1 }} />
      <Skeleton variant="rounded" width={260} height={40} sx={{ display: { xs: "none", sm: "block" } }} />
      <Skeleton variant="rounded" width={110} height={32} />
    </Stack>
  );
}

/** The toolbar (arrows + Today, the month, the view buttons) and a month grid. */
export function GridSkeleton({ height }: { height?: number | string }) {
  return (
    <Box data-testid="jc-skeleton-grid" sx={{ height: height ?? "100%", display: "flex", flexDirection: "column", minHeight: 480 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
        <Stack direction="row" spacing={1}>
          <Skeleton variant="rounded" width={72} height={32} />
          <Skeleton variant="rounded" width={56} height={32} />
        </Stack>
        <Skeleton variant="text" width={180} height={32} />
        <Skeleton variant="rounded" width={300} height={32} />
      </Stack>
      <Box sx={{ flex: 1, display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gridTemplateRows: "28px repeat(6, 1fr)", border: 1, borderColor: "divider", borderRadius: 1, overflow: "hidden" }}>
        {Array.from({ length: 49 }, (_, i) => (
          <Box key={i} sx={{ borderRight: (i + 1) % 7 ? 1 : 0, borderBottom: i < 42 ? 1 : 0, borderColor: "divider", p: 0.75 }}>
            {i < 7 ? <Skeleton variant="text" width="40%" sx={{ mx: "auto" }} /> : <Skeleton variant="text" width={18} sx={{ ml: "auto" }} />}
          </Box>
        ))}
      </Box>
    </Box>
  );
}

/** The whole block while the org's settings load: title, filter row and grid. */
export default function CalendarSkeleton({ fullHeight = false }: { fullHeight?: boolean }) {
  return (
    <Box sx={{ mb: 4, width: "100%" }} data-testid="jc-skeleton" aria-busy="true" aria-label="Loading the calendar">
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
        <Skeleton variant="circular" width={28} height={28} />
        <Skeleton variant="text" width={160} height={36} />
      </Stack>
      <FilterRowSkeleton />
      <GridSkeleton height={fullHeight ? "calc(100vh - 260px)" : 620} />
    </Box>
  );
}
