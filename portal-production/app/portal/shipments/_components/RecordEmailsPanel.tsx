"use client";

// Round AR — the emails linked to a shipment / an order (its link, any of its targets, or a file it filed there).
// A row opens the email in a pop-up (the inbox's email view).

import React, { useState } from "react";
import { Chip, CircularProgress, Dialog, DialogContent, DialogTitle, IconButton, Paper, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { useRecordEmails } from "../_lib/hooks";
import { fmtDate } from "../_lib/format";
import { EmailView } from "./inbox/EmailView";

/** One email in a pop-up, by its id (the inbox email view: headers, body, attachments). */
export function EmailPopup({ email, onClose }: { email: { id: string; subject: string | null } | null; onClose: () => void }) {
  return (
    <Dialog open={!!email} onClose={onClose} maxWidth="md" fullWidth transitionDuration={{ enter: 225, exit: 0 }} disableRestoreFocus>
      <DialogTitle sx={{ pr: 7 }}>
        <Typography variant="h6" component="div" sx={{ fontWeight: 700, wordBreak: "break-word", overflowWrap: "anywhere" }}>
          {email?.subject || "(no subject)"}
        </Typography>
        <IconButton aria-label="Close" onClick={onClose} sx={{ position: "absolute", right: 8, top: 8 }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>{email && <EmailView id={email.id} compactHeaders />}</DialogContent>
    </Dialog>
  );
}

export default function RecordEmailsPanel({ shipmentId, orderId, title = "Emails" }: { shipmentId?: string; orderId?: string; title?: string }) {
  const q = useRecordEmails({ shipmentId, orderId });
  const rows = q.data ?? [];
  const [open, setOpen] = useState<{ id: string; subject: string | null } | null>(null);
  return (
    <Paper variant="outlined" sx={{ p: 2 }} data-tour="record-emails">
      <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1 }}>
        {title}
        {rows.length ? ` (${rows.length})` : ""}
      </Typography>
      {q.isLoading ? (
        <CircularProgress size={20} />
      ) : q.isError ? (
        <Typography variant="body2" color="error">
          {(q.error as Error)?.message || "Could not load the emails"}
        </Typography>
      ) : !rows.length ? (
        <Typography variant="body2" color="text.secondary">
          No email is linked here yet.
        </Typography>
      ) : (
        <Table size="small" sx={{ "& td, & th": { px: 1 } }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ whiteSpace: "nowrap" }}>Date</TableCell>
              <TableCell>From</TableCell>
              <TableCell>Subject</TableCell>
              <TableCell align="right">Files</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} hover sx={{ cursor: "pointer" }} onClick={() => setOpen({ id: r.id, subject: r.subject })}>
                <TableCell sx={{ whiteSpace: "nowrap" }}>{fmtDate(r.date)}</TableCell>
                <TableCell sx={{ whiteSpace: "nowrap" }}>{r.fromDomain ?? r.counterparty ?? "—"}</TableCell>
                <TableCell sx={{ minWidth: 200 }}>
                  <Typography variant="body2" component="span" sx={{ wordBreak: "break-word", mr: 1 }}>
                    {r.subject || "(no subject)"}
                  </Typography>
                  {r.issue && <Chip size="small" variant="outlined" color="warning" label={`Issue: ${r.issue.title}`} sx={{ maxWidth: 240, mr: 0.5 }} />}
                  {r.targets > 1 && <Chip size="small" variant="outlined" label={`linked to ${r.targets} records`} />}
                </TableCell>
                <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                  {r.files ? `${r.files} file${r.files === 1 ? "" : "s"}` : "—"}
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
