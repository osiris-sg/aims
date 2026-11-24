"use client";

// HR > Live site (SiteClock web LiveSite.tsx @62b7d9d): who is clocked in right now, site by site.
// A supervisor sees their own sites and teams (the API scopes it). Refreshes every 30 seconds.
import * as React from "react";
import { Alert, Box, Chip, Link, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import FieldGate from "../_components/FieldGate";
import { useFieldApi } from "../_lib/useField";

const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const mapLink = (lat: number, lng: number) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`;
/** "3 h 05 min" since the clock-in. */
const since = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
};

export default function HrLiveSitePage() {
  return <FieldGate area="punches" title="Live site">{() => <LiveSite />}</FieldGate>;
}

function LiveSite() {
  const { get } = useFieldApi();
  const live = useQuery({ queryKey: ["field-live"], queryFn: () => get<{ sites: any[] }>(`/field/punches/live`), refetchInterval: 30_000 });
  const sites = live.data?.sites ?? [];
  const total = sites.reduce((n, s) => n + s.people.length, 0);
  return (
    <Stack gap={2}>
      {live.error && <Alert severity="error">{(live.error as Error).message}</Alert>}
      <Typography color="text.secondary">
        {live.isLoading ? "Loading…" : total === 0 ? "No one is clocked in." : `${total} clocked in at ${sites.length} ${sites.length === 1 ? "site" : "sites"}.`}
      </Typography>
      {sites.map((s) => (
        <Box key={s.id} data-testid="hr-live-site" sx={{ border: 1, borderColor: "divider", borderRadius: 2, overflow: "hidden" }}>
          <Stack direction="row" gap={1} alignItems="center" sx={{ px: 2, py: 1.25, flexWrap: "wrap" }}>
            <Typography variant="h6">{s.name}</Typography>
            <Chip size="small" label={`${s.people.length} on site`} />
            <Link href={mapLink(s.lat, s.lng)} target="_blank" rel="noreferrer">Map</Link>
          </Stack>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Worker</TableCell>
                <TableCell>Clocked in</TableCell>
                <TableCell>On the clock</TableCell>
                <TableCell>Where</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {s.people.map((p: any) => (
                <TableRow key={p.entryId}>
                  <TableCell>{p.name}</TableCell>
                  <TableCell>{clock(p.clockInAt)}</TableCell>
                  <TableCell>{since(p.clockInAt)}</TableCell>
                  <TableCell>
                    <Stack direction="row" gap={1} alignItems="center">
                      {p.insideFence === false ? <Chip size="small" color="warning" label="Clocked in outside the site" /> : p.insideFence === true ? "Inside the site" : ""}
                      {p.lat != null && p.lng != null && <Link href={mapLink(p.lat, p.lng)} target="_blank" rel="noreferrer">Map</Link>}
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      ))}
    </Stack>
  );
}
