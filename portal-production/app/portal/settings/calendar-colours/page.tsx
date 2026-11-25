"use client";

// Org Settings > Calendar colours (WCT group, 2026-11-25, enableCalendarStyle; Org Settings edit only, the server
// checks it). People: a colour per person on the jobs calendar's People list (fills their chips and their tick box).
// The same editor opens from the jobs calendar's "Settings" button (_components/CalendarColoursEditor.tsx).
// Every other org: the page says it is not available and the menu never links here.

import React from "react";
import { Alert, Box, Button, CircularProgress, Stack, Typography } from "@mui/material";
import MainCard from "@/components/MainCard";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import { CalendarColoursTables, useCalendarColours } from "./_components/CalendarColoursEditor";

export default function CalendarColoursPage() {
  const { features, isLoading } = useOrganizationFeatures();
  const on = features?.enableCalendarStyle === true;
  const state = useCalendarColours(on);
  const { page, error, setError, denied, saving, changes, save } = state;

  if (isLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  const title = (
    <Stack direction="row" alignItems="center" spacing={1} sx={{ width: "100%", mb: 2 }}>
      <Typography variant="h5" sx={{ fontWeight: 700, flex: 1 }}>
        Calendar colours
      </Typography>
      {on && page && (
        <Button variant="contained" disableElevation disabled={!changes || saving} onClick={() => void save()} data-tour="calendar-colours-save">
          {saving ? "Saving…" : "Save"}
        </Button>
      )}
    </Stack>
  );

  if (!on) {
    return (
      <MainCard>
        {title}
        <Alert severity="info">Calendar colours are not available for this organisation.</Alert>
      </MainCard>
    );
  }
  if (denied) {
    return (
      <MainCard>
        {title}
        <Alert severity="info">Only people with Org Settings edit can change the calendar colours.</Alert>
      </MainCard>
    );
  }

  return (
    <MainCard>
      {title}
      {error && (
        <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {!page ? <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>{!error && <CircularProgress size={24} />}</Box> : <CalendarColoursTables state={state} />}
    </MainCard>
  );
}
