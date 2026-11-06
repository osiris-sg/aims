"use client";

// Round BM — AIMEE / operator token usage (platform admins; the admin layout gates the page, the API checks too).
// Counters recorded per org, user, UTC day, channel and model by AiUsageService; no text. A row opens its users.
// No cap yet — this only measures.

import React, { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Alert, Box, Chip, CircularProgress, Stack, Table, TableBody, TableCell, TableHead, TableRow, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { request } from "@/helpers/request";

type Counts = { requests: number; inputTokens: number; outputTokens: number; cacheWriteTokens: number; cacheReadTokens: number; totalTokens: number };
type UserRow = Counts & { userId: string; name: string | null; channels: string[] };
type OrgRow = Counts & { organizationId: string; name: string; users: UserRow[] };
type Usage = { from: string; to: string; days: number; total: Counts; orgs: OrgRow[] };

const fmt = (n: number) => n.toLocaleString("en-US");

function Cells({ c }: { c: Counts }) {
  return (
    <>
      <TableCell align="right">{fmt(c.requests)}</TableCell>
      <TableCell align="right">{fmt(c.inputTokens)}</TableCell>
      <TableCell align="right">{fmt(c.outputTokens)}</TableCell>
      <TableCell align="right">{fmt(c.cacheWriteTokens)}</TableCell>
      <TableCell align="right">{fmt(c.cacheReadTokens)}</TableCell>
      <TableCell align="right" sx={{ fontWeight: 700 }}>
        {fmt(c.totalTokens)}
      </TableCell>
    </>
  );
}

export default function AiUsagePage() {
  const { getToken } = useAuth();
  const [days, setDays] = useState(7);
  const [data, setData] = useState<Usage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    (async () => {
      const token = await getToken();
      const res = await request({ path: `/admin/ai-usage?days=${days}`, method: "GET" }, {}, token ?? undefined);
      if (!alive) return;
      const d = res?.data ?? res;
      if (res?.success === false || !d?.orgs) setError(res?.message || "Could not load the usage.");
      else setData(d);
    })().catch((e) => alive && setError(e?.message || "Could not load the usage."));
    return () => {
      alive = false;
    };
  }, [days, getToken]);

  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2, flexWrap: "wrap", rowGap: 1 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          AI usage (AIMEE)
        </Typography>
        <ToggleButtonGroup size="small" exclusive value={days} onChange={(_, v) => v && setDays(v)}>
          <ToggleButton value={1}>Today</ToggleButton>
          <ToggleButton value={7}>7 days</ToggleButton>
          <ToggleButton value={30}>30 days</ToggleButton>
        </ToggleButtonGroup>
        {data && (
          <Typography variant="body2" color="text.secondary">
            {data.from} to {data.to} (UTC) · tokens of every AIMEE / WhatsApp assistant model call · no cap
          </Typography>
        )}
      </Stack>
      {error && <Alert severity="error">{error}</Alert>}
      {!data && !error && <CircularProgress size={24} />}
      {data && (
        <Box sx={{ overflowX: "auto" }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Organization / user</TableCell>
                <TableCell align="right">Requests</TableCell>
                <TableCell align="right">Input</TableCell>
                <TableCell align="right">Output</TableCell>
                <TableCell align="right">Cache write</TableCell>
                <TableCell align="right">Cache read</TableCell>
                <TableCell align="right">Total tokens</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.orgs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7}>
                    <Typography variant="body2" color="text.secondary">
                      No AIMEE usage recorded in this period yet.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
              {data.orgs.map((o) => (
                <React.Fragment key={o.organizationId}>
                  <TableRow hover sx={{ cursor: "pointer" }} onClick={() => setOpen(open === o.organizationId ? null : o.organizationId)}>
                    <TableCell sx={{ fontWeight: 600 }}>
                      {o.name} <Chip size="small" label={`${o.users.length} user${o.users.length === 1 ? "" : "s"}`} sx={{ ml: 1, height: 20 }} />
                    </TableCell>
                    <Cells c={o} />
                  </TableRow>
                  {open === o.organizationId &&
                    o.users.map((u) => (
                      <TableRow key={u.userId} sx={{ bgcolor: "action.hover" }}>
                        <TableCell sx={{ pl: 4 }}>
                          {u.name || u.userId} <Typography component="span" variant="caption" color="text.secondary">({u.channels.join(", ")})</Typography>
                        </TableCell>
                        <Cells c={u} />
                      </TableRow>
                    ))}
                </React.Fragment>
              ))}
              {data.orgs.length > 0 && (
                <TableRow>
                  <TableCell sx={{ fontWeight: 700 }}>All organizations</TableCell>
                  <Cells c={data.total} />
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Box>
      )}
    </Box>
  );
}
