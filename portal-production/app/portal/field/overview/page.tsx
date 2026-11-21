"use client";

// Field > Overview (FIELD_PLAN.md phase 7; SiteClock web Overview @62b7d9d): what needs doing now, each card opens its page.
import * as React from "react";
import Link from "next/link";
import { Card, CardActionArea, CardContent, Grid, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { FIELD_BASE, fieldAtLeast } from "@/helpers/fieldModule";
import FieldGate from "../_components/FieldGate";
import { useFieldApi, type FieldMe } from "../_lib/useField";

export default function FieldOverviewPage() {
  return <FieldGate area="reports" title="Overview">{(me) => <Overview me={me} />}</FieldGate>;
}

function Overview({ me }: { me: FieldMe }) {
  const { get } = useFieldApi();
  const q = useQuery({ queryKey: ["field-overview"], queryFn: () => get<any>("/field/reports/overview"), refetchInterval: 60_000 });
  const d = q.data ?? {};
  const can = (a: keyof FieldMe["access"]["levels"]) => me.areas.includes(a as any) && fieldAtLeast(me.access.levels[a], "view");
  const cards = [
    { label: "Flagged clock-ins", value: d.flagged, href: `${FIELD_BASE}/clock-ins`, show: can("punches") },
    { label: "On the clock now", value: d.onSite, href: `${FIELD_BASE}/timesheets`, show: can("timesheets") },
    { label: "Time to approve", value: d.toApprove, href: `${FIELD_BASE}/timesheets`, show: can("timesheets") },
    { label: "Of those, to check", value: d.needsReview, href: `${FIELD_BASE}/timesheets`, show: can("timesheets") },
    { label: "Missed clock-outs", value: d.autoClosed, href: `${FIELD_BASE}/timesheets`, show: can("timesheets") },
    { label: "Leave to approve", value: d.leaveToApprove, href: `${FIELD_BASE}/leave`, show: can("leave") },
  ].filter((c) => c.show);
  return (
    <Grid container spacing={2}>
      {cards.map((c) => (
        <Grid item xs={12} sm={6} md={4} key={c.label}>
          <Card variant="outlined">
            <CardActionArea component={Link} href={c.href}>
              <CardContent>
                <Typography variant="body2" color="text.secondary">{c.label}</Typography>
                <Typography variant="h4" sx={{ mt: 0.5 }}>{q.isLoading ? "…" : c.value ?? 0}</Typography>
              </CardContent>
            </CardActionArea>
          </Card>
        </Grid>
      ))}
      {!cards.length && (
        <Grid item xs={12}>
          <Typography color="text.secondary">Nothing to show: no Field area you can see is on.</Typography>
        </Grid>
      )}
    </Grid>
  );
}
