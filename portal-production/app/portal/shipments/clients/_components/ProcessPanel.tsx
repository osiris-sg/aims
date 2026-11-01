/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Round AY — Clients › a customer › Process: tick the steps that are part of this customer's process (Hoei ends at
// step 9). Every change shows its effect on the open orders first; Save applies it: unticked steps are hidden on the
// customer's open orders / shipments (not deleted), done steps stay done, completed orders never change.

import React, { useEffect, useMemo, useState } from "react";
import { Alert, Box, Button, Checkbox, Chip, CircularProgress, MenuItem, Paper, Stack, TextField, Typography } from "@mui/material";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useShipmentsApi, type ProcessImpact, type ProcessStepDef } from "../../_lib/api";
import { CLIENT_KEYS, SHIPMENT_KEYS } from "../../_lib/hooks";
import { endsAt, sameSkips, skipAfter, toggleSkip } from "../../_lib/process";
import { toast } from "../../_lib/toast";
import { ConfirmDialog } from "../../_components/bits";
import { useUserPermissions } from "@/app/portal/hooks/useUserPermissions";

export function impactLines(i: ProcessImpact, t: ReturnType<typeof useTranslations<"clients.process">>): string[] {
  const list = (xs: Array<{ ref: string; step: string }>) => xs.slice(0, 6).map((x) => `${x.ref} ${x.step}`).join(", ") + (xs.length > 6 ? ` +${xs.length - 6}` : "");
  return [
    t("affects", { o: i.openOrders, s: i.openShipments }),
    ...(i.hidden.length ? [t("hidden", { n: i.hidden.length, list: list(i.hidden) })] : []),
    ...(i.shown.length ? [t("shown", { n: i.shown.length, list: list(i.shown) })] : []),
    ...(i.doneKept.length ? [t("doneKept", { list: list(i.doneKept) })] : []),
    ...(i.completes.length ? [t("completes", { list: i.completes.join(", ") })] : []),
    t("completedNever"),
  ];
}

export default function ProcessPanel({ customerId, steps, skipSteps, lang }: { customerId: string; steps: ProcessStepDef[]; skipSteps: string[]; lang: "en" | "ja" }) {
  const t = useTranslations("clients.process");
  const { hasPermission, userRoles } = useUserPermissions();
  // Same convention as the Admin dashboard: no org roles = a platform admin viewing as the org (the API checks shipments:update).
  const canEdit = hasPermission("shipments", "update") || userRoles.length === 0;
  const api = useShipmentsApi();
  const qc = useQueryClient();
  const [skip, setSkip] = useState<string[]>(skipSteps);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => setSkip(skipSteps), [skipSteps]);
  const dirty = !sameSkips(skip, skipSteps);
  const last = useMemo(() => endsAt(steps, skip) ?? (skip.length ? "" : "all"), [steps, skip]);
  // The effect on the open orders, read again on every change (nothing is written).
  const pv = useQuery({
    queryKey: [...CLIENT_KEYS.all, "process-preview", customerId, skip.join(",")],
    enabled: dirty,
    queryFn: () => api.clientProcessPreview(customerId, skip),
    staleTime: 0,
  });
  const impact: ProcessImpact | null = dirty ? (pv.data ?? null) : null;
  const checking = dirty && pv.isFetching;
  useEffect(() => {
    if (pv.error) toast.error((pv.error as Error).message);
  }, [pv.error]);

  const save = async () => {
    await api.clientUpdateProcess(customerId, skip);
    await Promise.all([qc.invalidateQueries({ queryKey: CLIENT_KEYS.all }), qc.invalidateQueries({ queryKey: SHIPMENT_KEYS.orders }), qc.invalidateQueries({ queryKey: SHIPMENT_KEYS.shipments })]);
    toast.success(t("saved"));
  };

  return (
    <Paper variant="outlined" sx={{ p: 2 }} data-tour="client-process">
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>{t("intro")}</Typography>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <TextField
          select
          size="small"
          label={t("ends")}
          value={last}
          onChange={(e) => setSkip(e.target.value === "all" ? [] : skipAfter(steps, e.target.value))}
          disabled={!canEdit}
          sx={{ minWidth: 220 }}
          data-tour="process-ends-at"
          SelectProps={{ displayEmpty: true }}
        >
          <MenuItem value="all">{t("all")}</MenuItem>
          {steps.filter((s) => !s.ongoing).map((s) => (
            <MenuItem key={s.code} value={s.no}>
              {s.no}. {lang === "ja" ? s.ja : s.en}
            </MenuItem>
          ))}
          {last === "" && <MenuItem value="" disabled>—</MenuItem>}
        </TextField>
      </Stack>
      <Box>
        {steps.map((s) => {
          const on = !skip.includes(s.code);
          const always = s.code === "CHECK_CONTRACT";
          return (
            <Stack key={s.code} direction="row" alignItems="center" spacing={1} sx={{ py: 0.25, opacity: on ? 1 : 0.55 }}>
              <Checkbox size="small" checked={on} disabled={!canEdit || always} onChange={() => setSkip((cur) => toggleSkip(steps, cur, s.code))} inputProps={{ "aria-label": `${s.no} ${s.en}` }} />
              <Typography variant="body2" sx={{ width: 32, fontWeight: 700 }}>{s.no}</Typography>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" sx={{ textDecoration: on ? "none" : "line-through" }}>{lang === "ja" ? s.ja : s.en}</Typography>
                <Typography variant="caption" color="text.secondary">{lang === "ja" ? s.en : s.ja}</Typography>
              </Box>
              <Chip size="small" variant="outlined" label={s.scope === "ORDER" ? t("order") : t("shipment")} />
              {s.ongoing && <Chip size="small" variant="outlined" label={t("ongoing")} />}
              {always && <Chip size="small" variant="outlined" label={t("always")} />}
            </Stack>
          );
        })}
      </Box>
      {dirty && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 0.5 }}>{t("impact")}</Typography>
          {checking && !impact ? <CircularProgress size={18} /> : impact ? (
            <Alert severity={impact.completes.length ? "warning" : "info"} sx={{ "& ul": { m: 0, pl: 2 } }} data-tour="client-process-impact">
              <ul>{impactLines(impact, t).map((l) => <li key={l}>{l}</li>)}</ul>
            </Alert>
          ) : null}
          <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
            <Button variant="contained" disabled={!canEdit || !impact || checking} onClick={() => setConfirm(true)}>{t("save")}</Button>
            <Button onClick={() => setSkip(skipSteps)}>{t("reset")}</Button>
          </Stack>
        </Box>
      )}
      <ConfirmDialog
        open={confirm}
        title={t("confirmTitle")}
        body={impact ? <ul style={{ margin: 0, paddingLeft: 18 }}>{impactLines(impact, t).map((l) => <li key={l}>{l}</li>)}</ul> : null}
        confirmLabel={t("save")}
        onConfirm={save}
        onClose={() => setConfirm(false)}
      />
    </Paper>
  );
}
