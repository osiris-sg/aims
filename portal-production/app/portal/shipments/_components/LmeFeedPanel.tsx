"use client";

// Round AK — Settings → Shipping → LME: the Westmetall feed (LME Aluminium Cash-Settlement). Shows the source, the
// last fetch, the monthly averages next to the org's LME table (filled by Westmetall / typed and agrees / typed and
// DIFFERS — both values shown, never changed), the daily values of a month, and "Fetch now" (a preview while the
// org flag enableLmeFeed is off).

import React, { useState } from "react";
import { Alert, Box, Button, Chip, CircularProgress, Link as MuiLink, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import { useQueryClient } from "@tanstack/react-query";
import { useShipmentsApi, type LmeFetchResult, type LmeMonthState } from "../_lib/api";
import { SHIPMENT_KEYS, useLmeStatus } from "../_lib/hooks";
import { toast } from "../_lib/toast";

const usd = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthName = (m: string) => `${MON[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const STATE: Record<LmeMonthState, { label: string; color: "default" | "success" | "warning" | "error" | "info" }> = {
  missing: { label: "Not in the table", color: "default" },
  westmetall: { label: "Filled by Westmetall", color: "info" },
  "typed-agrees": { label: "Typed · agrees", color: "success" },
  "typed-differs": { label: "Typed · differs", color: "error" },
};

export default function LmeFeedPanel() {
  const [month, setMonth] = useState<string | undefined>(undefined);
  const status = useLmeStatus(month);
  const api = useShipmentsApi();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<LmeFetchResult | null>(null);
  const s = status.data;

  const fetchNow = async () => {
    setBusy(true);
    try {
      const r = await api.lmeFetch();
      setResult(r);
      if (!r.ok) toast.error(`Westmetall unavailable: ${r.error ?? "fetch failed"}`);
      else toast.success(r.preview ? "Preview ready — nothing was written" : "LME fetched");
      await qc.invalidateQueries({ queryKey: SHIPMENT_KEYS.config });
    } catch (e: any) {
      toast.error(e?.message || "Could not fetch the LME");
    } finally {
      setBusy(false);
    }
  };

  const plan = result?.orgs?.[0]?.plan;
  const revise = result?.orgs?.[0]?.revise ?? [];

  return (
    <Box sx={{ mt: 2, p: 1.5, border: 1, borderColor: "divider", borderRadius: 1 }} data-tour="settings-lme-feed">
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }} sx={{ mb: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            Source:{" "}
            <MuiLink href={s?.source.url ?? "https://www.westmetall.com/en/markdaten.php?action=table&field=LME_Al_cash"} target="_blank" rel="noopener noreferrer">
              Westmetall — LME Aluminium Cash-Settlement
            </MuiLink>
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
            {s?.source.schedule ?? "Daily 07:00 JST"} · monthly average = mean of the daily cash-settlement prices, rounded half-up to 2 dp · the running month is provisional until it ends.
            {s?.lastRun ? ` Last fetch ${when(s.lastRun.createdAt)}${s.lastRun.ok ? "" : " — failed"}.` : " Not fetched yet."}
          </Typography>
        </Box>
        {s && <Chip size="small" label={s.switchedOn ? "Feed on" : "Feed off — preview only"} color={s.switchedOn ? "success" : "default"} variant="outlined" />}
        <Button size="small" variant="outlined" startIcon={busy ? <CircularProgress size={14} /> : <RefreshIcon />} onClick={fetchNow} disabled={busy}>
          {s?.switchedOn ? "Fetch now" : "Preview"}
        </Button>
      </Stack>

      {s?.lastRun && !s.lastRun.ok && (
        <Alert severity="warning" sx={{ mb: 1 }}>
          LME feed unavailable: {s.lastRun.error}. Nothing was changed; the table keeps its values.
        </Alert>
      )}

      {result && result.ok && plan && (
        <Alert severity={plan.conflicts.length ? "warning" : "info"} sx={{ mb: 1 }}>
          {result.preview ? "Preview (feed off, nothing written): " : "Fetched: "}
          {plan.writes.length ? `${result.preview ? "would fill" : "filled"} ${plan.writes.map((w) => `${monthName(w.month)} ${usd(w.to)}${w.final ? "" : ` (provisional, ${w.days} days)`}`).join(" · ")}` : "no month to fill"}
          {plan.conflicts.length ? ` · typed months that differ (kept): ${plan.conflicts.map((c) => `${monthName(c.month)} table ${usd(c.table)} vs Westmetall ${usd(c.westmetall)}`).join(" · ")}` : ""}
          {revise.length ? ` · revise tasks: ${revise.map((r) => `${r.ref} ${r.docLabel}`).join(", ")}` : ""}
        </Alert>
      )}

      {s && s.months.length > 0 && (
        <Box sx={{ overflowX: "auto" }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Month</TableCell>
                <TableCell align="right">Westmetall</TableCell>
                <TableCell align="right">Days</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">AIMS table</TableCell>
                <TableCell>Table</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {s.months.map((m) => (
                <TableRow key={m.month} hover selected={m.month === s.month} sx={{ cursor: "pointer" }} onClick={() => setMonth(m.month)}>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{monthName(m.month)}</TableCell>
                  <TableCell align="right" sx={{ fontFamily: "monospace" }}>{usd(m.westmetall)}</TableCell>
                  <TableCell align="right">{m.days}</TableCell>
                  <TableCell>
                    <Chip size="small" label={m.final ? "Final" : "Provisional"} color={m.final ? "default" : "warning"} variant="outlined" />
                  </TableCell>
                  <TableCell align="right" sx={{ fontFamily: "monospace", color: m.state === "typed-differs" ? "error.main" : undefined }}>{usd(m.table)}</TableCell>
                  <TableCell>
                    <Chip size="small" label={STATE[m.state].label} color={STATE[m.state].color} variant={m.state === "typed-differs" ? "filled" : "outlined"} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}

      {s && s.days.length > 0 && (
        <Box sx={{ mt: 1.5 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
            Daily values · {monthName(s.month)} (click a month above)
          </Typography>
          <Box sx={{ overflowX: "auto", maxHeight: 260, overflowY: "auto" }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>Date</TableCell>
                  <TableCell align="right">Cash-Settlement</TableCell>
                  <TableCell align="right">3-month</TableCell>
                  <TableCell align="right">Stock (t)</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {s.days.map((d) => (
                  <TableRow key={d.date}>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>{d.date}</TableCell>
                    <TableCell align="right" sx={{ fontFamily: "monospace" }}>{usd(d.cash)}</TableCell>
                    <TableCell align="right" sx={{ fontFamily: "monospace" }}>{usd(d.threeMonth)}</TableCell>
                    <TableCell align="right">{d.stock?.toLocaleString("en-US") ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </Box>
      )}
      {s && !s.months.length && (
        <Typography variant="body2" color="text.secondary">
          No Westmetall values stored yet{s.switchedOn ? " — use Fetch now." : " (the feed is off: Preview shows what it would fill)."}
        </Typography>
      )}
    </Box>
  );
}
