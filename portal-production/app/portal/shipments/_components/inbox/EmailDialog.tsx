"use client";

// Round X — "Show the full email" opens the email in a POP-UP (owner: not an inline expand). The same view as an
// opened email in the timeline: the result box first, then the styled email with its attachments. Title = the
// subject, a caption "From Name (Company) · date"; closed with the X top-right, Esc or a click outside.

import React from "react";
import { Dialog, DialogContent, DialogTitle, IconButton, Stack, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import type { InboxLang, InboxMessage } from "../../_lib/api";
import { resultBox } from "../../_lib/inbox-cards";
import { fromParts, whenShort } from "../../_lib/inbox-threads";
import { EmailView } from "./EmailView";
import { ResultBoxView } from "./InboxDetails";

export function EmailDialog({ message, lang, open, onClose }: { message: InboxMessage | null; lang: InboxLang; open: boolean; onClose: () => void }) {
  const m = message;
  const from = m ? `${fromParts(m.from).name}${m.company ? ` (${m.company})` : ""}` : "";
  return (
    <Dialog open={open && !!m} onClose={onClose} maxWidth="md" fullWidth transitionDuration={{ enter: 225, exit: 0 }} disableRestoreFocus data-tour="email-popup">
      <DialogTitle sx={{ pr: 7 }}>
        <Typography variant="h6" component="div" sx={{ fontWeight: 700, minWidth: 0 }} noWrap title={m?.subject ?? ""}>
          {m?.subject || "(no subject)"}
        </Typography>
        {m && (
          <Typography variant="caption" color="text.secondary" component="div" noWrap title={m.from}>
            {lang === "ja" ? `${from} から` : `From ${from}`} · {whenShort(m.date)}
          </Typography>
        )}
        <IconButton aria-label="Close" onClick={onClose} sx={{ position: "absolute", right: 8, top: 8 }} data-tour="email-dialog-close">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {m && (
          <Stack spacing={1.5}>
            <ResultBoxView r={resultBox(m, lang)} lang={lang} />
            <EmailView id={m.id} compactHeaders company={m.company ?? null} lang={lang} />
          </Stack>
        )}
      </DialogContent>
    </Dialog>
  );
}
