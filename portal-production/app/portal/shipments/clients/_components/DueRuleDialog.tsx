/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Round BG — Clients › a customer › Process: change one step's due-date rule for this customer (or go back to the
// global default). The effect on the customer's open orders is read live (nothing is written) and shown before Save.

import React, { useEffect, useMemo, useState } from "react";
import { Alert, Box, Button, Checkbox, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Radio, RadioGroup, Stack, TextField, Typography } from "@mui/material";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useShipmentsApi, type CustomerDueRule, type DueAnchorCode, type DueRuleChange, type ProcessStepDef } from "../../_lib/api";
import { CLIENT_KEYS, SHIPMENT_KEYS } from "../../_lib/hooks";
import { fmtDay } from "../../_lib/format";
import { toast } from "../../_lib/toast";

const ANCHORS: DueAnchorCode[] = ["ORDER_CREATED", "FIRST_ETD", "LAST_ETA", "ETD", "ETA", "SHIP_MONTH_DAY", "SHIPPING_DOCS_DONE"];
const SHIPMENT_ONLY: DueAnchorCode[] = ["ETD", "ETA"];

export function useChangeText() {
  const t = useTranslations("clients.process.due");
  const badge = (b: string | null, due: string | null, since: string | null) => {
    const m = b ? /^(\d+)d overdue$/.exec(b) : null;
    if (m) return t("overdueBadge", { n: m[1] });
    return due && since && due < since ? t("noBadgeBefore", { since: fmtDay(since) }) : t("noBadge");
  };
  return (c: DueRuleChange, since: string | null) =>
    t("change", {
      ref: c.ref,
      no: c.no,
      from: `${c.before.due ? fmtDay(c.before.due) : t("unknown")} · ${badge(c.before.badge, c.before.due, since)}`,
      to: `${c.after.due ? fmtDay(c.after.due) : t("unknown")} · ${badge(c.after.badge, c.after.due, since)}`,
    });
}

export default function DueRuleDialog({ customerId, step, own, defaultText, lang, onClose }: { customerId: string; step: ProcessStepDef; own: Record<string, CustomerDueRule>; defaultText: string; lang: "en" | "ja"; onClose: () => void }) {
  const t = useTranslations("clients.process.due");
  const api = useShipmentsApi();
  const qc = useQueryClient();
  const changeText = useChangeText();
  const cur = own[step.code];
  const [mode, setMode] = useState<"default" | "custom">(cur ? "custom" : "default");
  const [anchor, setAnchor] = useState<DueAnchorCode>(cur?.anchor ?? (step.scope === "SHIPMENT" ? "ETA" : "FIRST_ETD"));
  const [days, setDays] = useState<string>(String(Math.abs(cur?.days ?? 0)));
  const [dir, setDir] = useState<"after" | "before">((cur?.days ?? 0) < 0 ? "before" : "after");
  const [business, setBusiness] = useState(!!cur?.business);
  const [day, setDay] = useState<string>(String(cur?.day ?? 9));
  const [daysText, setDaysText] = useState(cur?.daysText ?? "");
  const [busy, setBusy] = useState(false);
  const rule: CustomerDueRule | null = useMemo(() => {
    if (mode === "default") return null;
    const n = Math.max(0, Math.floor(Number(days) || 0));
    return { anchor, days: dir === "before" ? -n : n, ...(business ? { business: true } : {}), ...(anchor === "SHIP_MONTH_DAY" ? { day: Math.min(31, Math.max(1, Math.floor(Number(day) || 1))) } : {}), ...(daysText.trim() ? { daysText: daysText.trim() } : {}) };
  }, [mode, anchor, days, dir, business, day, daysText]);
  const next = useMemo(() => {
    const m = { ...own };
    if (rule) m[step.code] = rule;
    else delete m[step.code];
    return m;
  }, [own, rule, step.code]);
  const key = JSON.stringify(next);
  const pv = useQuery({ queryKey: [...CLIENT_KEYS.all, "due-preview", customerId, key], queryFn: () => api.clientDueRulesPreview(customerId, next), staleTime: 0 });
  useEffect(() => {
    if (pv.error) toast.error((pv.error as Error).message);
  }, [pv.error]);
  const words = rule ? pv.data?.words?.[step.code]?.[lang] : null;
  const anchors = step.scope === "ORDER" ? ANCHORS.filter((a) => !SHIPMENT_ONLY.includes(a)) : ANCHORS;

  const save = async () => {
    setBusy(true);
    try {
      await api.clientUpdateDueRules(customerId, next);
      await Promise.all([qc.invalidateQueries({ queryKey: CLIENT_KEYS.all }), qc.invalidateQueries({ queryKey: SHIPMENT_KEYS.orders })]);
      toast.success(t("saved"));
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth data-tour="client-due-rule-dialog">
      <DialogTitle>{t("dialogTitle", { no: step.no, name: lang === "ja" ? step.ja : step.en })}</DialogTitle>
      <DialogContent dividers>
        <RadioGroup value={mode} onChange={(e) => setMode(e.target.value as "default" | "custom")}>
          <FormControlLabel value="default" control={<Radio size="small" />} label={<Box><Typography variant="body2">{t("useDefault")}</Typography><Typography variant="caption" color="text.secondary">{defaultText}</Typography></Box>} />
          <FormControlLabel value="custom" control={<Radio size="small" />} label={<Typography variant="body2">{t("custom")}</Typography>} />
        </RadioGroup>
        {mode === "custom" && (
          <Stack spacing={1.5} sx={{ mt: 1, pl: 4 }}>
            <TextField select size="small" label={t("anchor")} value={anchor} onChange={(e) => setAnchor(e.target.value as DueAnchorCode)}>
              {anchors.map((a) => <MenuItem key={a} value={a}>{t(`a_${a}`)}</MenuItem>)}
            </TextField>
            {anchor === "SHIP_MONTH_DAY" && <TextField size="small" type="number" label={t("day")} value={day} onChange={(e) => setDay(e.target.value)} inputProps={{ min: 1, max: 31 }} sx={{ maxWidth: 200 }} />}
            <Stack direction="row" spacing={1}>
              <TextField size="small" type="number" label={t("days")} value={days} onChange={(e) => setDays(e.target.value)} inputProps={{ min: 0, max: 365 }} sx={{ width: 110 }} />
              <TextField select size="small" label={t("dir")} value={dir} onChange={(e) => setDir(e.target.value as "after" | "before")} sx={{ width: 130 }}>
                <MenuItem value="after">{t("after")}</MenuItem>
                <MenuItem value="before">{t("before")}</MenuItem>
              </TextField>
              <TextField size="small" label={t("daysText")} value={daysText} onChange={(e) => setDaysText(e.target.value)} sx={{ flex: 1 }} />
            </Stack>
            <FormControlLabel control={<Checkbox size="small" checked={business} onChange={(e) => setBusiness(e.target.checked)} />} label={<Typography variant="body2">{t("business")}</Typography>} />
            {words && <Typography variant="body2" sx={{ fontWeight: 700 }}>{t("ruleIs", { rule: words })}</Typography>}
          </Stack>
        )}
        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 0.5 }}>{t("preview")}</Typography>
          {pv.isFetching && !pv.data ? (
            <Stack direction="row" spacing={1} alignItems="center"><CircularProgress size={16} /><Typography variant="caption">{t("checking")}</Typography></Stack>
          ) : pv.data ? (
            pv.data.changes.length ? (
              <Alert severity="info" sx={{ "& ul": { m: 0, pl: 2 } }} data-tour="client-due-rule-preview">
                <ul>{pv.data.changes.map((c) => <li key={c.stepId}>{changeText(c, pv.data!.since)}</li>)}</ul>
              </Alert>
            ) : (
              <Typography variant="body2" color="text.secondary">{t("noChange")}</Typography>
            )
          ) : null}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("cancel")}</Button>
        <Button variant="contained" disabled={busy || pv.isFetching || !pv.data} onClick={save}>{t("save")}</Button>
      </DialogActions>
    </Dialog>
  );
}
