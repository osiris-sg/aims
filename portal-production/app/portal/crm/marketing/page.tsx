"use client";

// CRM → Marketing (guru 2026-09-21, for CIEL): Meta ads performance joined
// with AIMS's own pipeline. Meta tells us spend/CPC/watch time; AIMS knows
// which of those leads actually SIGNED and for how much — so this page shows
// true cost-per-lead, cost-per-signed-client and real ROAS, trended monthly.
// Management view only (the API 404s designer/junior tiers).

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Grid, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow,
  TextField, Tooltip, Typography,
} from "@mui/material";
import SyncIcon from "@mui/icons-material/Sync";
import LinkIcon from "@mui/icons-material/Link";
import LinkOffIcon from "@mui/icons-material/LinkOff";
import MainCard from "@/components/MainCard";
import { useWhatsAppApi } from "../_lib/api";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";

type Overview = {
  connection: { connected: boolean; accountName?: string | null; currency?: string | null; status?: string; lastError?: string | null; lastSyncAt?: string | null };
  months: string[];
  totals: { spend: number; clicks: number; impressions: number; metaLeads: number; aimsLeads: number; converted: number; signedValue: number; cpc: number | null; cpl: number | null; trueCpl: number | null; roas: number | null; costPerSigned: number | null };
  monthly: Array<{ month: string; spend: number; clicks: number; impressions: number; metaLeads: number; aimsLeads: number; converted: number; signedValue: number; cpc: number | null; cpl: number | null; trueCpl: number | null; roas: number | null }>;
  campaigns: Array<any>;
  ads: Array<any>;
};

const fmt = (n: number | null | undefined, dp = 0) =>
  n == null ? "—" : new Intl.NumberFormat("en-SG", { maximumFractionDigits: dp, minimumFractionDigits: 0 }).format(n);
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString("en-SG", { month: "short", year: "2-digit" });

function KPI({ label, value, hint, color }: { label: string; value: React.ReactNode; hint?: string; color?: string }) {
  return (
    <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, height: "100%" }}>
      <Typography variant="overline" sx={{ color: "text.secondary", lineHeight: 1.4 }}>
        {label}
      </Typography>
      <Typography variant="h6" sx={{ fontWeight: 800, color: color || "text.primary", fontVariantNumeric: "tabular-nums" }}>
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

export default function MarketingPage() {
  const { request } = useWhatsAppApi();
  const { isAdsInsightsEnabled, isLoading: flagsLoading } = useOrganizationFeatures() as any;
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [adAccountId, setAdAccountId] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await request<Overview>(`/marketing/ads/overview?months=6`);
      setData(r);
      setError(null);
    } catch (e: any) {
      setError(e.message || "Failed to load");
    }
  }, [request]);
  useEffect(() => {
    load();
  }, [load]);

  const cur = data?.connection?.currency || "SGD";
  const money = (n: number | null | undefined, dp = 0) => (n == null ? "—" : `${cur === "SGD" ? "S$" : cur} ${fmt(n, dp)}`);

  const connect = async () => {
    setBusy(true);
    try {
      await request(`/marketing/ads/connect`, { method: "POST", body: JSON.stringify({ adAccountId, accessToken: token }) });
      setConnectOpen(false);
      setToken("");
      await load();
    } catch (e: any) {
      setError(e.message || "Connection failed");
    } finally {
      setBusy(false);
    }
  };

  const sync = async () => {
    setSyncing(true);
    try {
      await request(`/marketing/ads/sync`, { method: "POST", body: JSON.stringify({ days: 90 }) });
      await load();
    } catch (e: any) {
      setError(e.message || "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm("Disconnect the ad account? Synced history stays.")) return;
    await request(`/marketing/ads/disconnect`, { method: "POST" }).catch(() => null);
    await load();
  };

  const maxSpend = useMemo(() => Math.max(1, ...(data?.monthly || []).map((r) => r.spend)), [data]);

  if (flagsLoading && !data) {
    return (
      <MainCard>
        <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
          <CircularProgress />
        </Box>
      </MainCard>
    );
  }
  if (!flagsLoading && !isAdsInsightsEnabled) {
    return (
      <MainCard>
        <Alert severity="info">Marketing insights are not enabled for this organization. An admin can switch on “Ads Insights” in the admin panel.</Alert>
      </MainCard>
    );
  }

  const t = data?.totals;
  const conn = data?.connection;

  return (
    <MainCard>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2.5, flexWrap: "wrap", rowGap: 1 }}>
        <Box sx={{ flex: 1, minWidth: 220 }}>
          <Typography variant="h4" sx={{ fontWeight: 800 }}>
            Marketing
          </Typography>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            Meta ads performance · last 6 months · joined with AIMS leads and signed contracts
          </Typography>
        </Box>
        {conn?.connected ? (
          <>
            <Chip size="small" color="success" variant="outlined" label={`Connected · ${conn.accountName || "ad account"}`} />
            {conn.lastSyncAt && (
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                synced {new Date(conn.lastSyncAt).toLocaleString("en-SG", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
              </Typography>
            )}
            <Button size="small" variant="outlined" startIcon={syncing ? <CircularProgress size={14} /> : <SyncIcon />} disabled={syncing} onClick={sync}>
              Sync now
            </Button>
            <Tooltip title="Disconnect ad account">
              <Button size="small" color="error" startIcon={<LinkOffIcon />} onClick={disconnect}>
                Disconnect
              </Button>
            </Tooltip>
          </>
        ) : (
          <Button variant="contained" startIcon={<LinkIcon />} onClick={() => setConnectOpen(true)} data-tour="ads-connect">
            Connect ad account
          </Button>
        )}
      </Stack>

      {conn?.status === "ERROR" && conn.lastError && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Last sync failed: {conn.lastError}
        </Alert>
      )}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {!conn?.connected && (
        <Paper variant="outlined" sx={{ p: 3, borderRadius: 2, mb: 2.5 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
            Connect the Meta ad account
          </Typography>
          <Typography variant="body2" sx={{ color: "text.secondary", maxWidth: 720 }}>
            1. The client adds this business as a <b>Partner</b> on their ad account in Meta Business Settings (View performance is enough).
            <br />
            2. In this business&apos;s Business Settings, create a <b>System user</b>, assign that ad account, and <b>Generate token</b> (scopes <code>ads_read</code>, <code>read_insights</code>, expiry Never).
            <br />
            3. Paste the ad account ID (the <code>act_…</code> number) and the token here — the first sync pulls 90 days of history.
          </Typography>
        </Paper>
      )}

      {data && conn?.connected && (
        <>
          {/* KPI row */}
          <Grid container spacing={1.5} sx={{ mb: 2.5 }}>
            <Grid item xs={6} md={1.7}>
              <KPI label="Ad spend" value={money(t?.spend)} hint={`${fmt(t?.impressions)} impressions`} />
            </Grid>
            <Grid item xs={6} md={1.7}>
              <KPI label="CPC" value={money(t?.cpc, 2)} hint={`${fmt(t?.clicks)} clicks`} />
            </Grid>
            <Grid item xs={6} md={1.7}>
              <KPI label="CPL (Meta)" value={money(t?.cpl, 2)} hint={`${fmt(t?.metaLeads)} leads reported`} />
            </Grid>
            <Grid item xs={6} md={1.7}>
              <KPI label="True CPL (AIMS)" value={money(t?.trueCpl, 2)} hint={`${fmt(t?.aimsLeads)} FB/IG leads in AIMS`} />
            </Grid>
            <Grid item xs={6} md={1.7}>
              <KPI label="Cost per signed" value={money(t?.costPerSigned)} hint={`${fmt(t?.converted)} signed clients`} />
            </Grid>
            <Grid item xs={6} md={1.7}>
              <KPI label="Signed value" value={money(t?.signedValue)} hint="contracts from ad leads" />
            </Grid>
            <Grid item xs={6} md={1.8}>
              <KPI label="ROAS" value={t?.roas != null ? `${fmt(t.roas, 2)}×` : "—"} hint="signed value ÷ spend" color={t?.roas != null ? (t.roas >= 1 ? "success.main" : "warning.main") : undefined} />
            </Grid>
          </Grid>

          {/* Monthly trend — spend bars with CPL/ROAS per month */}
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, mb: 2.5 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1.5 }}>
              Month by month — is it getting better?
            </Typography>
            <Stack spacing={1}>
              {data.monthly.map((r) => (
                // Phone: fixed-width number captions wrap under the bar instead of overflowing
                <Stack key={r.month} direction="row" alignItems="center" spacing={1.5} sx={{ flexWrap: { xs: "wrap", md: "nowrap" }, rowGap: 0.25 }}>
                  <Typography variant="caption" sx={{ width: 52, color: "text.secondary", flexShrink: 0 }}>
                    {monthLabel(r.month)}
                  </Typography>
                  <Box sx={{ flex: 1, minWidth: { xs: 80, md: 100 } }}>
                    <Box sx={{ height: 14, borderRadius: 1, bgcolor: "primary.main", opacity: 0.85, width: `${Math.max(2, (r.spend / maxSpend) * 100)}%` }} />
                  </Box>
                  <Typography variant="caption" sx={{ width: 90, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {money(r.spend)}
                  </Typography>
                  <Typography variant="caption" sx={{ width: 100, textAlign: "right", color: "text.secondary", fontVariantNumeric: "tabular-nums" }}>
                    CPL {money(r.trueCpl ?? r.cpl, 0)}
                  </Typography>
                  <Typography variant="caption" sx={{ width: 110, textAlign: "right", fontVariantNumeric: "tabular-nums", color: r.roas != null && r.roas >= 1 ? "success.main" : "text.secondary" }}>
                    {r.converted > 0 ? `${r.converted} signed · ` : ""}ROAS {r.roas != null ? `${fmt(r.roas, 1)}×` : "—"}
                  </Typography>
                </Stack>
              ))}
            </Stack>
            <Typography variant="caption" sx={{ color: "text.disabled", display: "block", mt: 1 }}>
              ROAS counts a lead&apos;s signed contract value in the month the lead arrived — reno deals close weeks later, so recent months read low until their leads sign.
            </Typography>
          </Paper>

          {/* Campaigns */}
          <Paper variant="outlined" sx={{ borderRadius: 2, mb: 2.5, overflow: "hidden" }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, px: 2, pt: 1.5, pb: 0.5 }}>
              Campaigns
            </Typography>
            <Box sx={{ overflowX: "auto" }}>
              <Table size="small" sx={{ minWidth: 820 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>Campaign</TableCell>
                    <TableCell align="right">Spend</TableCell>
                    <TableCell align="right">Impressions</TableCell>
                    <TableCell align="right">Clicks</TableCell>
                    <TableCell align="right">CPC</TableCell>
                    <TableCell align="right">Leads</TableCell>
                    <TableCell align="right">CPL</TableCell>
                    <TableCell align="right">ThruPlays</TableCell>
                    <TableCell align="right">Avg watch</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.campaigns.map((c) => (
                    <TableRow key={c.campaignId} hover>
                      <TableCell sx={{ fontWeight: 600, maxWidth: 260 }}>{c.name}</TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>{money(c.spend)}</TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>{fmt(c.impressions)}</TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>{fmt(c.clicks)}</TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>{money(c.cpc, 2)}</TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>{fmt(c.metaLeads)}</TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>{money(c.cpl, 2)}</TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>{fmt(c.thruplays)}</TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>{c.avgWatchSec != null ? `${fmt(c.avgWatchSec, 1)}s` : "—"}</TableCell>
                    </TableRow>
                  ))}
                  {!data.campaigns.length && (
                    <TableRow>
                      <TableCell colSpan={9} sx={{ color: "text.disabled" }}>
                        No insight rows yet — hit Sync now, or wait for tonight&apos;s automatic sync.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Box>
          </Paper>

          {/* Creatives — which video/content is doing well */}
          <Paper variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, px: 2, pt: 1.5, pb: 0.5 }}>
              Content performance
              <Typography component="span" variant="caption" sx={{ color: "text.secondary", ml: 1 }}>
                per ad creative — watch time and completion show which videos hold attention
              </Typography>
            </Typography>
            <Box sx={{ overflowX: "auto" }}>
              <Table size="small" sx={{ minWidth: 900 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>Ad</TableCell>
                    <TableCell>Campaign</TableCell>
                    <TableCell align="right">Spend</TableCell>
                    <TableCell align="right">CTR</TableCell>
                    <TableCell align="right">CPC</TableCell>
                    <TableCell align="right">Leads</TableCell>
                    <TableCell align="right">CPL</TableCell>
                    <TableCell align="right">ThruPlays</TableCell>
                    <TableCell align="right">Avg watch</TableCell>
                    <TableCell align="right">Watched to end</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.ads.map((a) => (
                    <TableRow key={a.adId} hover>
                      <TableCell sx={{ fontWeight: 600, maxWidth: 240 }}>{a.name}</TableCell>
                      <TableCell sx={{ color: "text.secondary", maxWidth: 180 }}>{a.campaign}</TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>{money(a.spend)}</TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>{a.ctr != null ? `${fmt(a.ctr, 2)}%` : "—"}</TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>{money(a.cpc, 2)}</TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>{fmt(a.metaLeads)}</TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>{money(a.cpl, 2)}</TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>{fmt(a.thruplays)}</TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>{a.avgWatchSec != null ? `${fmt(a.avgWatchSec, 1)}s` : "—"}</TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>{a.completionPct != null ? `${fmt(a.completionPct)}%` : "—"}</TableCell>
                    </TableRow>
                  ))}
                  {!data.ads.length && (
                    <TableRow>
                      <TableCell colSpan={10} sx={{ color: "text.disabled" }}>
                        No creatives yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Box>
          </Paper>
        </>
      )}

      {/* Connect dialog */}
      <Dialog open={connectOpen} onClose={() => !busy && setConnectOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Connect Meta ad account</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <TextField label="Ad account ID" placeholder="act_1234567890 or 1234567890" value={adAccountId} onChange={(e) => setAdAccountId(e.target.value)} size="small" fullWidth autoFocus />
            <TextField label="System-user access token" value={token} onChange={(e) => setToken(e.target.value)} size="small" fullWidth multiline minRows={2} helperText="Generated in Business Settings → System users → Generate token (ads_read + read_insights, expiry Never). Stored server-side, never shown again." />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConnectOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="contained" onClick={connect} disabled={busy || !adAccountId.trim() || !token.trim()}>
            {busy ? "Verifying…" : "Connect & sync"}
          </Button>
        </DialogActions>
      </Dialog>
    </MainCard>
  );
}
