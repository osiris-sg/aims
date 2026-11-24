"use client";

// Field pages render only when the area is on for the org and the person may view it; otherwise the
// route does not exist (404), the same as the API (FieldAreaGuard).
import * as React from "react";
import { notFound } from "next/navigation";
import { Alert, Box, CircularProgress, Stack, Typography } from "@mui/material";
import MainCard from "@/components/MainCard";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import { fieldAtLeast, type FieldArea } from "@/helpers/fieldModule";
import { useFieldMe, type FieldMe } from "../_lib/useField";

export default function FieldGate({
  area,
  title,
  actions,
  children,
}: {
  area: FieldArea;
  title: string;
  actions?: React.ReactNode;
  children: (me: FieldMe) => React.ReactNode;
}) {
  const { fieldAreas, isLoading } = useOrganizationFeatures();
  const { me, loading, error } = useFieldMe();
  if (isLoading || loading) {
    return (
      <Box sx={{ display: "grid", placeItems: "center", py: 8 }}>
        <CircularProgress size={28} />
      </Box>
    );
  }
  if (!fieldAreas?.includes(area)) notFound();
  if (error || !me) return <Alert severity="error">{error?.message || "HR is not available"}</Alert>;
  if (!fieldAtLeast(me.access.levels[area], "view")) notFound();
  return (
    <MainCard>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2, gap: 1, flexWrap: "wrap" }}>
        <Typography variant="h4" sx={{ fontWeight: 700 }}>
          {title}
        </Typography>
        <Stack direction="row" gap={1} flexWrap="wrap">
          {actions}
        </Stack>
      </Stack>
      {children(me)}
    </MainCard>
  );
}
