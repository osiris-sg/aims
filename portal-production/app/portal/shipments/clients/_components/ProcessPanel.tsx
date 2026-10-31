/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Round AY — Clients › a customer › Process: tick the steps that are part of this customer's process (Hoei ends at
// step 9). Every change shows its effect on the open orders first; Save applies it: unticked steps are hidden on the
// customer's open orders / shipments (not deleted), done steps stay done, completed orders never change.

import React, { useEffect, useMemo, useState } from "react";
import { Alert, Box, Button, Checkbox, Chip, CircularProgress, MenuItem, Paper, Stack, TextField, Typography } from "@mui/material";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useShipmentsApi, type ProcessImpact, type ProcessStepDef } from "../../_lib/api";
import { CLIENT_KEYS, SHIPMENT_KEYS } from "../../_lib/hooks";
import { endsAt, sameSkips, skipAfter, toggleSkip } from "../../_lib/process";
import { toast } from "../../_lib/toast";
import { ConfirmDialog } from "../../_components/bits";
import { useUserPermissions } from "@/app/portal/hooks/useUserPermissions";

const L = {
  en: {
    intro: "Tick the steps that are part of this customer's process. Orders and shipments of this customer only show and require the ticked steps.",
    ends: "Process ends at step",
    all: "All steps",
    order: "Order",
    shipment: "Shipment",
    ongoing: "ongoing",
    always: "always",
    impact: "Effect on open orders",
    none: "No change on the open orders.",
    save: "Save process",
    reset: "Undo changes",
    confirmTitle: "Change this customer's process?",
    saved: "Process saved",
  },
  ja: {
    intro: "この顧客のプロセスに含まれるステップにチェックを入れてください。この顧客の注文・出荷では、チェックしたステップだけが表示・必須になります。",
    ends: "最終ステップ",
    all: "全ステップ",
    order: "注文",
    shipment: "出荷",
    ongoing: "随時",
    always: "必須",
    impact: "未完了の注文への影響",
    none: "未完了の注文に変更はありません。",
    save: "プロセスを保存",
    reset: "元に戻す",
    confirmTitle: "この顧客のプロセスを変更しますか？",
    saved: "プロセスを保存しました",
  },
} as const;

export function impactLines(i: ProcessImpact, lang: "en" | "ja"): string[] {
  const ja = lang === "ja";
  const list = (xs: Array<{ ref: string; step: string }>) => xs.slice(0, 6).map((x) => `${x.ref} ${x.step}`).join(", ") + (xs.length > 6 ? ` +${xs.length - 6}` : "");
  return [
    ja ? `未完了の注文 ${i.openOrders} 件（出荷 ${i.openShipments} 件）が対象です。` : `Affects ${i.openOrders} open order${i.openOrders === 1 ? "" : "s"} (${i.openShipments} shipment${i.openShipments === 1 ? "" : "s"}).`,
    ...(i.hidden.length ? [ja ? `非表示になるステップ ${i.hidden.length} 件（削除はしません）: ${list(i.hidden)}` : `${i.hidden.length} not-done step${i.hidden.length === 1 ? "" : "s"} become hidden (not deleted): ${list(i.hidden)}`] : []),
    ...(i.shown.length ? [ja ? `再表示されるステップ ${i.shown.length} 件: ${list(i.shown)}` : `${i.shown.length} step${i.shown.length === 1 ? "" : "s"} come back: ${list(i.shown)}`] : []),
    ...(i.doneKept.length ? [ja ? `完了済みのステップはそのまま: ${list(i.doneKept)}` : `Done steps stay done: ${list(i.doneKept)}`] : []),
    ...(i.completes.length ? [ja ? `完了になる: ${i.completes.join(", ")}` : `Will complete (every remaining step is done): ${i.completes.join(", ")}`] : []),
    ja ? "完了済みの注文は変わりません。" : "Completed orders never change.",
  ];
}

export default function ProcessPanel({ customerId, steps, skipSteps, lang }: { customerId: string; steps: ProcessStepDef[]; skipSteps: string[]; lang: "en" | "ja" }) {
  const t = L[lang];
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
    toast.success(t.saved);
  };

  return (
    <Paper variant="outlined" sx={{ p: 2 }} data-tour="client-process">
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>{t.intro}</Typography>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <TextField
          select
          size="small"
          label={t.ends}
          value={last}
          onChange={(e) => setSkip(e.target.value === "all" ? [] : skipAfter(steps, e.target.value))}
          disabled={!canEdit}
          sx={{ minWidth: 220 }}
          data-tour="process-ends-at"
          SelectProps={{ displayEmpty: true }}
        >
          <MenuItem value="all">{t.all}</MenuItem>
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
              <Chip size="small" variant="outlined" label={s.scope === "ORDER" ? t.order : t.shipment} />
              {s.ongoing && <Chip size="small" variant="outlined" label={t.ongoing} />}
              {always && <Chip size="small" variant="outlined" label={t.always} />}
            </Stack>
          );
        })}
      </Box>
      {dirty && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 0.5 }}>{t.impact}</Typography>
          {checking && !impact ? <CircularProgress size={18} /> : impact ? (
            <Alert severity={impact.completes.length ? "warning" : "info"} sx={{ "& ul": { m: 0, pl: 2 } }} data-tour="client-process-impact">
              <ul>{impactLines(impact, lang).map((l) => <li key={l}>{l}</li>)}</ul>
            </Alert>
          ) : null}
          <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
            <Button variant="contained" disabled={!canEdit || !impact || checking} onClick={() => setConfirm(true)}>{t.save}</Button>
            <Button onClick={() => setSkip(skipSteps)}>{t.reset}</Button>
          </Stack>
        </Box>
      )}
      <ConfirmDialog
        open={confirm}
        title={t.confirmTitle}
        body={impact ? <ul style={{ margin: 0, paddingLeft: 18 }}>{impactLines(impact, lang).map((l) => <li key={l}>{l}</li>)}</ul> : null}
        confirmLabel={t.save}
        onConfirm={save}
        onClose={() => setConfirm(false)}
      />
    </Paper>
  );
}
