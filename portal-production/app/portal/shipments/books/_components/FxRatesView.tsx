"use client";

// Round BW — ADH books › FX rates: the rate of the 1st of each month (1 SGD = rate USD / JPY), typed by ADH Admin /
// Manager. Lot postings use their delivery month's rate (FRS 2.1). One row per month; a row opens its rates.

import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField, Typography } from "@mui/material";
import { useTranslations } from "next-intl";
import PageTable from "@/components/PageTable";
import { useShipmentsApi, type FxRateRow } from "../../_lib/api";
import { toast } from "../../_lib/toast";
import { EmptyState } from "../../_components/bits";
import { InfoTip } from "./BooksBits";

type MonthRow = { month: string; USD: FxRateRow | null; JPY: FxRateRow | null };
const thisMonth = () => new Date().toISOString().slice(0, 7);
const fmtRate = (r: FxRateRow | null) => (r ? String(r.rate) : "—");
const by = (r: MonthRow) => [r.USD, r.JPY].filter(Boolean).sort((a, b) => (b!.enteredAt > a!.enteredAt ? 1 : -1))[0] ?? null;

export default function FxRatesView() {
  const t = useTranslations("books.fx");
  const api = useShipmentsApi();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["trade-books", "fx-rates"], queryFn: () => api.fxRates() });
  const [edit, setEdit] = useState<{ month: string; currency: "USD" | "JPY"; rate: string; note: string; isNew: boolean } | null>(null);
  const save = useMutation({
    mutationFn: (e: NonNullable<typeof edit>) => api.saveFxRate({ month: e.month, currency: e.currency, rate: Number(e.rate), note: e.note || null }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["trade-books"] });
      toast.success(t("saved"));
      setEdit(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = useMemo<MonthRow[]>(() => {
    const m = new Map<string, MonthRow>();
    for (const r of list.data ?? []) {
      const row = m.get(r.month) ?? { month: r.month, USD: null, JPY: null };
      row[r.currency] = r;
      m.set(r.month, row);
    }
    return [...m.values()].sort((a, b) => b.month.localeCompare(a.month));
  }, [list.data]);

  const open = (r: MonthRow | null) => {
    const cur = r?.USD ?? null;
    setEdit({ month: r?.month ?? thisMonth(), currency: "USD", rate: cur ? String(cur.rate) : "", note: cur?.note ?? "", isNew: !r });
  };
  const pick = (month: string, currency: "USD" | "JPY") => {
    const r = (list.data ?? []).find((x) => x.month === month && x.currency === currency);
    setEdit((e) => (e ? { ...e, month, currency, rate: r ? String(r.rate) : "", note: r?.note ?? "" } : e));
  };

  const columns = useMemo(
    () => [
      { id: "month", header: t("month"), cell: ({ row }: any) => <Typography variant="body2" sx={{ fontWeight: 700 }}>{row.original.month}</Typography> },
      { id: "usd", header: t("usd"), cell: ({ row }: any) => fmtRate(row.original.USD) },
      { id: "jpy", header: t("jpy"), cell: ({ row }: any) => fmtRate(row.original.JPY) },
      { id: "by", header: t("enteredBy"), cell: ({ row }: any) => by(row.original)?.enteredByName ?? "—" },
      { id: "at", header: t("enteredAt"), cell: ({ row }: any) => by(row.original)?.enteredAt?.slice(0, 10) ?? "—" },
    ],
    [t],
  );

  const valid = !!edit && /^\d{4}-(0[1-9]|1[0-2])$/.test(edit.month) && Number(edit.rate) > 0;
  return (
    <Box sx={{ p: { xs: 1.5, md: 3 }, height: "100%" }} data-tour="books-fx-rates">
      <PageTable
        tableName={t("title")}
        buttonName={t("add")}
        onAddClick={() => open(null)}
        columns={columns as any}
        data={rows}
        loading={list.isLoading}
        noSelectionColumn
        onRowClick={(r: MonthRow) => open(r)}
        actionButtons={[<InfoTip key="info" text={t("info")} />]}
        hideTable={!list.isLoading && !list.isError && !rows.length}
        headerContent={
          list.isError ? (
            <Alert severity="error">{(list.error as Error)?.message}</Alert>
          ) : !list.isLoading && !rows.length ? (
            <EmptyState title={t("empty")} action={<Button variant="contained" onClick={() => open(null)}>{t("add")}</Button>} />
          ) : undefined
        }
      />
      <Dialog open={!!edit} onClose={() => !save.isPending && setEdit(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{edit?.isNew ? t("newTitle") : t("editTitle", { month: edit?.month ?? "", currency: edit?.currency ?? "" })}</DialogTitle>
        <DialogContent>
          {edit && (
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField type="month" label={t("month")} value={edit.month} onChange={(e) => pick(e.target.value, edit.currency)} InputLabelProps={{ shrink: true }} disabled={!edit.isNew} />
              <TextField select label={t("currency")} value={edit.currency} onChange={(e) => pick(edit.month, e.target.value as "USD" | "JPY")}>
                <MenuItem value="USD">USD</MenuItem>
                <MenuItem value="JPY">JPY</MenuItem>
              </TextField>
              <TextField label={`${t("rate")} (1 SGD = ? ${edit.currency})`} value={edit.rate} onChange={(e) => setEdit({ ...edit, rate: e.target.value.replace(/[^0-9.]/g, "") })} inputProps={{ inputMode: "decimal" }} autoFocus />
              <TextField label={t("note")} value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEdit(null)} disabled={save.isPending}>{t("cancel")}</Button>
          <Button variant="contained" disabled={!valid || save.isPending} onClick={() => edit && save.mutate(edit)}>{t("save")}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

