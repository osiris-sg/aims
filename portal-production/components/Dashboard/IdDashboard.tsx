"use client";

// Interior-design dashboard (enableIdQuotation orgs, CIEL 09-01).
// Designers see THEIR numbers and leads; Management/admin see every designer.
// Revenue = contract value (signed quotation + confirmed VOs) of projects
// started this year, tracked against the manager-set yearly target.

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import {
  Box, Button, Chip, CircularProgress, Grid, LinearProgress, Paper, Stack,
  Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import MainCard from "@/components/MainCard";

const apiBase = process.env.NEXT_PUBLIC_BACKEND_API_URL;

type Row = {
  userId: string | null; name: string; ongoing: number; done: number;
  revenueYtd: number; target: number | null; projectedProfit: number; earnings: number;
  leads: { open: number; converted: number; dead: number };
};
type Payload = {
  scope: "self" | "all"; year: number; designers: Row[];
  totals: { ongoing: number; done: number; revenueYtd: number; target: number | null; projectedProfit: number; earnings: number };
  myLeads: Array<{ id: string; name: string; status: string; source: string; phone: string | null; assignedToName: string | null; firstContactDeadline: string | null; receivedAt: string }>;
};

const money = (n: number | null | undefined) => `S$ ${new Intl.NumberFormat("en-SG", { maximumFractionDigits: 0 }).format(Number(n) || 0)}`;

function KPI({ label, value, hint, color }: { label: string; value: React.ReactNode; hint?: string; color?: string }) {
  return (
    <Paper variant="outlined" sx={{ p: 1.75, borderRadius: 2, height: "100%" }}>
      <Typography variant="overline" sx={{ color: "text.secondary", lineHeight: 1.4 }}>
        {label}
      </Typography>
      <Typography variant="h5" sx={{ fontWeight: 800, color: color || "text.primary", fontVariantNumeric: "tabular-nums" }}>
        {value}
      </Typography>
      {hint && (
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {hint}
        </Typography>
      )}
    </Paper>
  );
}

function TargetBar({ revenue, target }: { revenue: number; target: number | null }) {
  if (!target) return <Typography variant="caption" sx={{ color: "text.disabled" }}>no target set</Typography>;
  const pct = Math.min(100, (revenue / target) * 100);
  return (
    <Box sx={{ minWidth: 120 }}>
      <LinearProgress variant="determinate" value={pct} sx={{ height: 6, borderRadius: 3, mb: 0.25 }} color={pct >= 100 ? "success" : pct >= 60 ? "primary" : "warning"} />
      <Typography variant="caption" sx={{ color: "text.secondary" }}>
        {pct.toFixed(0)}% of {money(target)}
      </Typography>
    </Box>
  );
}

export default function IdDashboard() {
  const router = useRouter();
  const { getToken } = useAuth();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      const activeOrgId = typeof window !== "undefined" ? window.sessionStorage.getItem("aims-admin-active-org") : null;
      if (activeOrgId) headers["X-Active-Org-Id"] = activeOrgId;
      const res = await fetch(`${apiBase}/id-projects/dashboard`, { headers });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message?.message || json?.message || "Failed to load dashboard");
      setData(json?.data ?? json);
    } catch (e: any) {
      setError(e.message || "Failed to load dashboard");
    }
  }, [getToken]);
  useEffect(() => {
    load();
  }, [load]);

  if (error)
    return (
      <MainCard>
        <Typography color="error">{error}</Typography>
      </MainCard>
    );
  if (!data)
    return (
      <MainCard>
        <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
          <CircularProgress />
        </Box>
      </MainCard>
    );

  const self = data.scope === "self";
  const me = self ? data.designers[0] : null;
  const t = self && me ? me : data.totals;
  const deadlinePassed = (d: string | null) => d && new Date(d).getTime() < Date.now();

  return (
    <MainCard>
      <Stack direction="row" alignItems="center" sx={{ mb: 2.5 }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h4" sx={{ fontWeight: 800 }}>
            {self ? "My dashboard" : "Dashboard"}
          </Typography>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            {data.year} · {self ? "your projects and leads" : "all designers"}
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => router.push("/portal/projects?new=1")} sx={{ textTransform: "none" }} data-tour="dash-create-project">
          Create project
        </Button>
      </Stack>

      {/* KPI row */}
      <Grid container spacing={1.5} sx={{ mb: 2.5 }}>
        <Grid item xs={6} md={2.4}>
          <KPI label="Ongoing projects" value={t.ongoing} />
        </Grid>
        <Grid item xs={6} md={2.4}>
          <KPI label="Completed" value={t.done} />
        </Grid>
        <Grid item xs={6} md={2.4}>
          <KPI label={`Revenue ${data.year}`} value={money(t.revenueYtd)} hint={t.target ? `target ${money(t.target)}` : "no target set"} color={t.target && t.revenueYtd >= t.target ? "success.main" : undefined} />
        </Grid>
        <Grid item xs={6} md={2.4}>
          <KPI label="Projected profit" value={money(t.projectedProfit)} hint="contract − costs, all ongoing" />
        </Grid>
        <Grid item xs={6} md={2.4}>
          <KPI label={self ? "My earnings (projected)" : "Commissions (projected)"} value={money(t.earnings)} hint="commission % × projected profit" />
        </Grid>
      </Grid>

      {t.target != null && (
        <Paper variant="outlined" sx={{ p: 1.75, borderRadius: 2, mb: 2.5 }}>
          <Stack direction="row" alignItems="center" spacing={2}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, whiteSpace: "nowrap" }}>
              {data.year} target
            </Typography>
            <Box sx={{ flex: 1 }}>
              <LinearProgress variant="determinate" value={Math.min(100, (t.revenueYtd / t.target) * 100)} sx={{ height: 10, borderRadius: 5 }} color={t.revenueYtd >= t.target ? "success" : "primary"} />
            </Box>
            <Typography variant="body2" sx={{ fontWeight: 700, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
              {money(t.revenueYtd)} / {money(t.target)}
            </Typography>
          </Stack>
        </Paper>
      )}

      {/* Management: per-designer table */}
      {!self && (
        <Paper variant="outlined" sx={{ borderRadius: 2, mb: 2.5, overflow: "hidden" }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, px: 2, pt: 1.5, pb: 0.5 }}>
            Designers
          </Typography>
          <Box sx={{ overflowX: "auto" }}>
            <Table size="small" sx={{ minWidth: 860 }}>
              <TableHead>
                <TableRow>
                  <TableCell>Designer</TableCell>
                  <TableCell align="right">Ongoing</TableCell>
                  <TableCell align="right">Done</TableCell>
                  <TableCell align="right">Revenue {data.year}</TableCell>
                  <TableCell>Vs target</TableCell>
                  <TableCell align="right">Projected profit</TableCell>
                  <TableCell align="right">Earnings</TableCell>
                  <TableCell align="right">Leads open / won / dead</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.designers.map((r) => (
                  <TableRow key={r.userId || r.name} hover>
                    <TableCell sx={{ fontWeight: 600 }}>{r.name}</TableCell>
                    <TableCell align="right">{r.ongoing}</TableCell>
                    <TableCell align="right">{r.done}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>{money(r.revenueYtd)}</TableCell>
                    <TableCell>
                      <TargetBar revenue={r.revenueYtd} target={r.target} />
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>{money(r.projectedProfit)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>{money(r.earnings)}</TableCell>
                    <TableCell align="right">
                      {r.leads.open} / {r.leads.converted} / {r.leads.dead}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </Paper>
      )}

      {/* Open leads (mine for designers, org-wide for management) */}
      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
        <Stack direction="row" alignItems="center" sx={{ px: 2, pt: 1.5, pb: 0.5 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, flex: 1 }}>
            {self ? "My open leads" : "Open leads"}
          </Typography>
          <Button size="small" endIcon={<OpenInNewIcon />} onClick={() => router.push("/portal/sales/leads")} sx={{ textTransform: "none" }}>
            All leads
          </Button>
        </Stack>
        {data.myLeads.length === 0 ? (
          <Typography variant="body2" sx={{ color: "text.disabled", px: 2, py: 2 }}>
            Nothing open — new leads land here automatically.
          </Typography>
        ) : (
          <Box sx={{ overflowX: "auto" }}>
            <Table size="small" sx={{ minWidth: 640 }}>
              <TableHead>
                <TableRow>
                  <TableCell>Lead</TableCell>
                  <TableCell>Source</TableCell>
                  <TableCell>Status</TableCell>
                  {!self && <TableCell>Assigned</TableCell>}
                  <TableCell>Received</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {data.myLeads.map((l) => (
                  <TableRow key={l.id} hover>
                    <TableCell sx={{ fontWeight: 600 }}>{l.name}</TableCell>
                    <TableCell>
                      <Chip size="small" variant="outlined" label={(l.source || "manual").toUpperCase()} sx={{ height: 20 }} />
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5}>
                        <Chip size="small" color={l.status === "engaging" ? "info" : "primary"} variant="outlined" label={l.status} sx={{ height: 20 }} />
                        {l.status === "unqualified" && l.firstContactDeadline && (
                          <Chip size="small" color={deadlinePassed(l.firstContactDeadline) ? "error" : "warning"} label={deadlinePassed(l.firstContactDeadline) ? "24h missed" : "contact <24h"} sx={{ height: 20 }} />
                        )}
                      </Stack>
                    </TableCell>
                    {!self && <TableCell>{l.assignedToName || "—"}</TableCell>}
                    <TableCell>
                      <Typography variant="caption">{new Date(l.receivedAt).toLocaleDateString("en-SG", { day: "2-digit", month: "short" })}</Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Button size="small" onClick={() => router.push("/portal/sales/leads")} sx={{ textTransform: "none" }}>
                        Open
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
      </Paper>
    </MainCard>
  );
}
