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
import { fmtMonth } from "../_lib/format";
import { useTranslations } from "next-intl";
import { currentLang, formatDateTime } from "@/i18n/lang";

const usd = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const monthName = (m: string) => fmtMonth(m.slice(0, 7));
const when = (iso: string) => (currentLang() === "ja" ? formatDateTime(iso) : new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }));

// Labels: settings.lmeFeed.state.<state> in the catalogs.
const STATE: Record<LmeMonthState, { color: "default" | "success" | "warning" | "error" | "info" }> = {
  missing: { color: "default" },
  westmetall: { color: "info" },
  "typed-agrees": { color: "success" },
  "typed-differs": { color: "error" },
};

export default function LmeFeedPanel() {
  const t = useTranslations("settings.lmeFeed");
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
      if (!r.ok) toast.error(t("unavailable", { error: r.error ?? t("fetchFailed") }));
      else toast.success(r.preview ? t("previewReady") : t("fetched"));
      await qc.invalidateQueries({ queryKey: SHIPMENT_KEYS.config });
    } catch (e: any) {
      toast.error(e?.message || t("couldNotFetch"));
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
            {t("source")}{" "}
            <MuiLink href={s?.source.url ?? "https://www.westmetall.com/en/markdaten.php?action=table&field=LME_Al_cash"} target="_blank" rel="noopener noreferrer">
              Westmetall — LME Aluminium Cash-Settlement
            </MuiLink>
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
            {s?.source.schedule ?? t("schedule")} {t("method")}
            {s?.lastRun ? t("lastFetch", { when: when(s.lastRun.createdAt), failed: s.lastRun.ok ? "" : t("failed") }) : t("notFetched")}
          </Typography>
        </Box>
        {s && <Chip size="small" label={s.switchedOn ? t("feedOn") : t("feedOff")} color={s.switchedOn ? "success" : "default"} variant="outlined" />}
        <Button size="small" variant="outlined" startIcon={busy ? <CircularProgress size={14} /> : <RefreshIcon />} onClick={fetchNow} disabled={busy}>
          {s?.switchedOn ? t("fetchNow") : t("preview")}
        </Button>
      </Stack>

      {s?.lastRun && !s.lastRun.ok && (
        <Alert severity="warning" sx={{ mb: 1 }}>
          {t("feedUnavailable", { error: s.lastRun.error ?? "" })}
        </Alert>
      )}

      {result && result.ok && plan && (
        <Alert severity={plan.conflicts.length ? "warning" : "info"} sx={{ mb: 1 }}>
          {result.preview ? t("resultPreview") : t("resultFetched")}
          {plan.writes.length ? `${result.preview ? t("wouldFill") : t("filled")} ${plan.writes.map((w) => `${monthName(w.month)} ${usd(w.to)}${w.final ? "" : t("provisionalDays", { n: w.days })}`).join(" · ")}` : t("noMonth")}
          {plan.conflicts.length ? t("conflicts", { list: plan.conflicts.map((c) => t("conflict", { month: monthName(c.month), table: usd(c.table), westmetall: usd(c.westmetall) })).join(" · ") }) : ""}
          {revise.length ? t("revise", { list: revise.map((r) => `${r.ref} ${r.docLabel}`).join(", ") }) : ""}
        </Alert>
      )}

      {s && s.months.length > 0 && (
        <Box sx={{ overflowX: "auto" }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t("colMonth")}</TableCell>
                <TableCell align="right">Westmetall</TableCell>
                <TableCell align="right">{t("colDays")}</TableCell>
                <TableCell>{t("colStatus")}</TableCell>
                <TableCell align="right">{t("colAimsTable")}</TableCell>
                <TableCell>{t("colTable")}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {s.months.map((m) => (
                <TableRow key={m.month} hover selected={m.month === s.month} sx={{ cursor: "pointer" }} onClick={() => setMonth(m.month)}>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{monthName(m.month)}</TableCell>
                  <TableCell align="right" sx={{ fontFamily: "monospace" }}>{usd(m.westmetall)}</TableCell>
                  <TableCell align="right">{m.days}</TableCell>
                  <TableCell>
                    <Chip size="small" label={m.final ? t("final") : t("provisional")} color={m.final ? "default" : "warning"} variant="outlined" />
                  </TableCell>
                  <TableCell align="right" sx={{ fontFamily: "monospace", color: m.state === "typed-differs" ? "error.main" : undefined }}>{usd(m.table)}</TableCell>
                  <TableCell>
                    <Chip size="small" label={t(`state.${m.state}`)} color={STATE[m.state].color} variant={m.state === "typed-differs" ? "filled" : "outlined"} />
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
            {t("dailyValues", { month: monthName(s.month) })}
          </Typography>
          <Box sx={{ overflowX: "auto", maxHeight: 260, overflowY: "auto" }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>{t("colDate")}</TableCell>
                  <TableCell align="right">{t("colCash")}</TableCell>
                  <TableCell align="right">{t("colThreeMonth")}</TableCell>
                  <TableCell align="right">{t("colStock")}</TableCell>
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
          {s.switchedOn ? t("emptyOn") : t("emptyOff")}
        </Typography>
      )}
    </Box>
  );
}
