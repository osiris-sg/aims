"use client";

// Round AR — the emails linked to a shipment / an order (its link, any of its targets, or a file it filed there).
// A row opens the email in a pop-up (the inbox's email view).

import React, { useState } from "react";
import { Chip, CircularProgress, Dialog, DialogContent, DialogTitle, IconButton, Paper, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { useTranslations } from "next-intl";
import { useRecordEmails } from "../_lib/hooks";
import { fmtDate } from "../_lib/format";
import { EmailView } from "./inbox/EmailView";

/** One email in a pop-up, by its id (the inbox email view: headers, body, attachments). */
export function EmailPopup({ email, onClose }: { email: { id: string; subject: string | null } | null; onClose: () => void }) {
  const t = useTranslations("shipments.recordEmails");
  return (
    <Dialog open={!!email} onClose={onClose} maxWidth="md" fullWidth transitionDuration={{ enter: 225, exit: 0 }} disableRestoreFocus>
      <DialogTitle sx={{ pr: 7 }}>
        <Typography variant="h6" component="div" sx={{ fontWeight: 700, wordBreak: "break-word", overflowWrap: "anywhere" }}>
          {email?.subject || t("noSubject")}
        </Typography>
        <IconButton aria-label={t("close")} onClick={onClose} sx={{ position: "absolute", right: 8, top: 8 }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>{email && <EmailView id={email.id} compactHeaders />}</DialogContent>
    </Dialog>
  );
}

export default function RecordEmailsPanel({ shipmentId, orderId, title }: { shipmentId?: string; orderId?: string; title?: string }) {
  const t = useTranslations("shipments.recordEmails");
  const q = useRecordEmails({ shipmentId, orderId });
  const rows = q.data ?? [];
  const [open, setOpen] = useState<{ id: string; subject: string | null } | null>(null);
  return (
    <Paper variant="outlined" sx={{ p: 2 }} data-tour="record-emails">
      <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1 }}>
        {title ?? t("title")}
        {rows.length ? ` (${rows.length})` : ""}
      </Typography>
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
        <Table size="small" sx={{ "& td, & th": { px: 1 } }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ whiteSpace: "nowrap" }}>{t("date")}</TableCell>
              <TableCell>{t("from")}</TableCell>
              <TableCell>{t("subject")}</TableCell>
              <TableCell align="right">{t("files")}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} hover sx={{ cursor: "pointer" }} onClick={() => setOpen({ id: r.id, subject: r.subject })}>
                <TableCell sx={{ whiteSpace: "nowrap" }}>{fmtDate(r.date)}</TableCell>
                <TableCell sx={{ whiteSpace: "nowrap" }}>{r.fromDomain ?? r.counterparty ?? "—"}</TableCell>
                <TableCell sx={{ minWidth: 200 }}>
                  <Typography variant="body2" component="span" sx={{ wordBreak: "break-word", mr: 1 }}>
                    {r.subject || t("noSubject")}
                  </Typography>
                  {r.issue && <Chip size="small" variant="outlined" color="warning" label={t("issue", { title: r.issue.title })} sx={{ maxWidth: 240, mr: 0.5 }} />}
                  {r.targets > 1 && <Chip size="small" variant="outlined" label={t("linkedTo", { n: r.targets })} />}
                </TableCell>
                <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                  {r.files ? t("fileCount", { n: r.files }) : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <EmailPopup email={open} onClose={() => setOpen(null)} />
    </Paper>
  );
}
