"use client";

// Round BW — ADH books › Chart of accounts: the provisional chart (620 / 810 / 200 / 310 + system accounts). A row
// opens its code and name to edit; ADH's Xero chart is imported later.

import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from "@mui/material";
import { useTranslations } from "next-intl";
import PageTable from "@/components/PageTable";
import { useShipmentsApi, type BooksAccount } from "../../_lib/api";
import { toast } from "../../_lib/toast";
import { EmptyState } from "../../_components/bits";
import { InfoTip } from "./BooksBits";

export default function ChartView() {
  const t = useTranslations("books.chart");
  const api = useShipmentsApi();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["trade-books", "chart"], queryFn: () => api.booksChart() });
  const [edit, setEdit] = useState<{ id: string; code: string; name: string; was: string } | null>(null);
  const save = useMutation({
    mutationFn: (e: NonNullable<typeof edit>) => api.updateBooksAccount(e.id, { code: e.code.trim(), name: e.name.trim() }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["trade-books"] });
      toast.success(t("saved"));
      setEdit(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const rows = list.data ?? [];
  const columns = useMemo(
    () => [
      { id: "code", header: t("code"), cell: ({ row }: any) => <Typography variant="body2" sx={{ fontFamily: "monospace", fontWeight: 700 }}>{row.original.code}</Typography> },
      { id: "name", header: t("name"), cell: ({ row }: any) => row.original.name },
      { id: "type", header: t("type"), cell: ({ row }: any) => <Typography variant="body2" color="text.secondary">{String(row.original.accountType).replace(/_/g, " ").toLowerCase()}</Typography> },
      { id: "status", header: t("status"), cell: ({ row }: any) => (row.original.provisional ? <Chip size="small" variant="outlined" color="warning" label={t("provisional")} /> : null) },
    ],
    [t],
  );
  return (
    <Box sx={{ p: { xs: 1.5, md: 3 }, height: "100%" }} data-tour="books-chart">
      <PageTable
        tableName={t("title")}
        columns={columns as any}
        data={rows}
        loading={list.isLoading}
        noSelectionColumn
        onRowClick={(r: BooksAccount) => setEdit({ id: r.id, code: r.code, name: r.name, was: r.code })}
        actionButtons={[<InfoTip key="info" text={t("info")} />]}
        clientPaging
        hideTable={!list.isLoading && !list.isError && !rows.length}
        headerContent={list.isError ? <Alert severity="error">{(list.error as Error)?.message}</Alert> : !list.isLoading && !rows.length ? <EmptyState title={t("empty")} /> : undefined}
      />
      <Dialog open={!!edit} onClose={() => !save.isPending && setEdit(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t("editTitle", { code: edit?.was ?? "" })}</DialogTitle>
        <DialogContent>
          {edit && (
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField label={t("code")} value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value })} />
              <TextField label={t("name")} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEdit(null)} disabled={save.isPending}>{t("cancel")}</Button>
          <Button variant="contained" disabled={!edit?.code.trim() || !edit?.name.trim() || save.isPending} onClick={() => edit && save.mutate(edit)}>{t("save")}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

