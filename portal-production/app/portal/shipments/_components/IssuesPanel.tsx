"use client";

// Round AR — general issues on a supplier / customer / order: a process or policy change that is not about one
// shipment (Vedanta: "Mixed-batch bundles: manual COA + ADH material code from Sep supplies"). Open first; never
// deleted, only set Resolved (and reopened). Shown on the Clients profiles and the order page; the affected shipments
// show a banner on their step (IssueBanner).

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, Menu, MenuItem, Paper, Stack, TextField, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import MailOutlineIcon from "@mui/icons-material/MailOutline";
import { useTranslations } from "next-intl";
import { toast } from "../_lib/toast";
import { useIssues, useTradeMutation } from "../_lib/hooks";
import { fmtDate, fmtDateTime } from "../_lib/format";
import type { IssueBody, TradeIssue } from "../_lib/api";
import { EmailPopup } from "./RecordEmailsPanel";

const COA = "CUSTOMER_COA";

type Form = { title: string; summaryEn: string; summaryJa: string; effectiveFrom: string; coa: boolean };
const EMPTY: Form = { title: "", summaryEn: "", summaryJa: "", effectiveFrom: "", coa: false };

export default function IssuesPanel({ customerId, supplierId, orderId, title: titleProp }: { customerId?: string; supplierId?: string; orderId?: string; title?: string }) {
  const t = useTranslations("inbox.issues");
  const title = titleProp ?? t("title");
  const q = useIssues({ customerId, supplierId, orderId });
  const rows = useMemo(() => [...(q.data ?? [])].sort((a, b) => (a.status === b.status ? 0 : a.status === "OPEN" ? -1 : 1)), [q.data]);
  const create = useTradeMutation((a, body: IssueBody) => a.createIssue(body));
  const update = useTradeMutation((a, v: { id: string; body: IssueBody }) => a.updateIssue(v.id, v.body));
  const [menu, setMenu] = useState<{ pos: { left: number; top: number }; row: TradeIssue } | null>(null);
  const [edit, setEdit] = useState<{ row: TradeIssue | null; form: Form } | null>(null);
  const [email, setEmail] = useState<{ id: string; subject: string | null } | null>(null);
  const openCount = rows.filter((r) => r.status === "OPEN").length;

  const save = async () => {
    if (!edit) return;
    const f = edit.form;
    if (!f.title.trim()) return toast.error(t("titleRequired"));
    const others = (edit.row?.docTypes ?? []).filter((d) => d !== COA);
    const body: IssueBody = {
      title: f.title.trim(),
      summaryEn: f.summaryEn,
      summaryJa: f.summaryJa,
      effectiveFrom: f.effectiveFrom,
      docTypes: f.coa ? [...others, COA] : others,
    };
    try {
      if (edit.row) {
        await update.mutateAsync({ id: edit.row.id, body });
        toast.success(t("saved"));
      } else {
        await create.mutateAsync({ ...body, ...(customerId ? { customerId } : {}), ...(supplierId ? { supplierId } : {}), ...(orderId ? { orderIds: [orderId] } : {}) });
        toast.success(t("added"));
      }
      setEdit(null);
    } catch (e: unknown) {
      toast.error((e as Error)?.message || t("couldNotSave"));
    }
  };

  const setStatus = async (row: TradeIssue, status: "OPEN" | "RESOLVED") => {
    setMenu(null);
    try {
      await update.mutateAsync({ id: row.id, body: { status } });
      toast.success(status === "RESOLVED" ? t("resolvedToast") : t("reopenedToast"));
    } catch (e: unknown) {
      toast.error((e as Error)?.message || t("couldNotUpdate"));
    }
  };

  const setF = (patch: Partial<Form>) => setEdit((x) => (x ? { ...x, form: { ...x.form, ...patch } } : x));
  const busy = create.isPending || update.isPending;

  return (
    <Paper variant="outlined" sx={{ p: 2 }} data-tour="issues-panel">
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 800, flex: 1 }}>
          {title}
          {rows.length ? ` (${t("openCount", { n: openCount })})` : ""}
        </Typography>
        <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={() => setEdit({ row: null, form: EMPTY })} data-tour="issue-add">
          {t("add")}
        </Button>
      </Stack>
      {q.isLoading ? (
        <CircularProgress size={20} />
      ) : q.isError ? (
        <Typography variant="body2" color="error">
          {(q.error as Error)?.message || t("couldNotLoad")}
        </Typography>
      ) : !rows.length ? (
        <Typography variant="body2" color="text.secondary">
          {t("empty")}
        </Typography>
      ) : (
        <Stack spacing={1}>
          {rows.map((r) => {
            const resolved = r.status === "RESOLVED";
            return (
              <Box key={r.id} sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5, opacity: resolved ? 0.75 : 1 }}>
                <Stack direction="row" spacing={1} alignItems="flex-start">
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                      <Typography variant="body1" sx={{ fontWeight: 700, wordBreak: "break-word" }}>
                        {r.title}
                      </Typography>
                      <Chip size="small" variant="outlined" color={resolved ? "success" : "warning"} label={resolved ? t("resolved") : t("open")} />
                      {r.docTypes.includes(COA) && <Chip size="small" variant="outlined" label={t("step4")} />}
                      {r.effectiveFrom && (
                        <Typography variant="caption" color="text.secondary">
                          {t("from", { d: r.effectiveFrom })}
                        </Typography>
                      )}
                    </Stack>
                    {r.summaryEn && (
                      <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: "pre-wrap" }}>
                        {r.summaryEn}
                      </Typography>
                    )}
                    {r.summaryJa && (
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25, whiteSpace: "pre-wrap" }}>
                        {r.summaryJa}
                      </Typography>
                    )}
                    {(r.shipments.length > 0 || r.orders.length > 0) && (
                      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.75 }}>
                        {r.orders.map((o) => (
                          <Chip key={o.id} size="small" variant="outlined" color="primary" label={o.ref ?? t("order")} component={Link} href={`/portal/shipments/orders/${o.id}`} clickable />
                        ))}
                        {r.shipments.map((s) => (
                          <Chip key={s.id} size="small" variant="outlined" color="info" label={s.ref ?? t("shipment")} component={Link} href={`/portal/shipments/${s.id}`} clickable />
                        ))}
                      </Stack>
                    )}
                    {r.emails.length > 0 && (
                      <Stack spacing={0.25} sx={{ mt: 0.75 }}>
                        {r.emails.map((m) => (
                          <Box
                            key={m.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => setEmail({ id: m.id, subject: m.subject })}
                            onKeyDown={(e) => e.key === "Enter" && setEmail({ id: m.id, subject: m.subject })}
                            sx={{ display: "flex", alignItems: "center", gap: 0.75, cursor: "pointer", color: "text.secondary", "&:hover": { color: "primary.main" } }}
                          >
                            <MailOutlineIcon sx={{ fontSize: 16 }} />
                            <Typography variant="caption" sx={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {m.subject || t("noSubject")} · {fmtDate(m.date)}
                              {m.from ? ` · ${m.from}` : ""}
                            </Typography>
                          </Box>
                        ))}
                      </Stack>
                    )}
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.75 }}>
                      {[r.customerName, r.supplierName].filter(Boolean).join(" · ")}
                      {r.customerName || r.supplierName ? " · " : ""}
                      {r.createdByName ? t("addedBy", { name: r.createdByName, at: fmtDateTime(r.createdAt) }) : t("addedAt", { at: fmtDateTime(r.createdAt) })}
                      {resolved ? ` · ${r.resolvedByName ? t("resolvedBy", { name: r.resolvedByName }) : t("resolved")}${r.resolvedAt ? ` ${fmtDateTime(r.resolvedAt)}` : ""}` : ""}
                    </Typography>
                  </Box>
                  <IconButton size="small" aria-label={t("actions")} onClick={(e) => setMenu({ pos: { left: e.clientX, top: e.clientY }, row: r })}>
                    <MoreVertIcon fontSize="small" />
                  </IconButton>
                </Stack>
              </Box>
            );
          })}
        </Stack>
      )}

      <Menu anchorReference="anchorPosition" anchorPosition={menu?.pos} open={!!menu} onClose={() => setMenu(null)}>
        <MenuItem
          onClick={() => {
            const r = menu!.row;
            setMenu(null);
            setEdit({ row: r, form: { title: r.title, summaryEn: r.summaryEn ?? "", summaryJa: r.summaryJa ?? "", effectiveFrom: r.effectiveFrom ?? "", coa: r.docTypes.includes(COA) } });
          }}
        >
          {t("edit")}
        </MenuItem>
        {menu?.row.status === "OPEN" ? (
          <MenuItem disabled={busy} onClick={() => void setStatus(menu.row, "RESOLVED")}>
            {t("markResolved")}
          </MenuItem>
        ) : (
          <MenuItem disabled={busy} onClick={() => menu && void setStatus(menu.row, "OPEN")}>
            {t("reopen")}
          </MenuItem>
        )}
      </Menu>

      <Dialog open={!!edit} onClose={() => !busy && setEdit(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{edit?.row ? t("editTitle") : t("add")}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label={t("fTitle")} required autoFocus fullWidth size="small" value={edit?.form.title ?? ""} onChange={(e) => setF({ title: e.target.value })} inputProps={{ maxLength: 200 }} />
            <TextField label={t("fSummaryEn")} fullWidth multiline minRows={2} size="small" value={edit?.form.summaryEn ?? ""} onChange={(e) => setF({ summaryEn: e.target.value })} />
            <TextField label={t("fSummaryJa")} fullWidth multiline minRows={2} size="small" value={edit?.form.summaryJa ?? ""} onChange={(e) => setF({ summaryJa: e.target.value })} />
            <TextField
              label={t("fEffective")}
              fullWidth
              size="small"
              placeholder={t("fEffectiveHint")}
              value={edit?.form.effectiveFrom ?? ""}
              onChange={(e) => setF({ effectiveFrom: e.target.value })}
              inputProps={{ maxLength: 80 }}
            />
            <FormControlLabel control={<Checkbox checked={!!edit?.form.coa} onChange={(e) => setF({ coa: e.target.checked })} />} label={t("fCoa")} />
            <Typography variant="caption" color="text.secondary">
              {orderId
                ? t("linkedOrder")
                : t("linkedClient")}{" "}
              {t("neverDeleted")}
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEdit(null)} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button variant="contained" onClick={() => void save()} disabled={busy || !edit?.form.title.trim()}>
            {edit?.row ? t("save") : t("add")}
          </Button>
        </DialogActions>
      </Dialog>

      <EmailPopup email={email} onClose={() => setEmail(null)} />
    </Paper>
  );
}
