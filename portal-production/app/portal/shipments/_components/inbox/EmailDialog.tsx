"use client";

// Round X — "Show the full email" opens the email in a POP-UP (owner: not an inline expand). The same view as an
// opened email in the timeline: the result box first, then the styled email with its attachments. Title = the
// subject, a caption "From Name (Company) · date"; closed with the X top-right, Esc or a click outside.
// Round AV: "+ New shipment…" and, when the email is linked to a shipment, "Edit #n-m" — the same side drawer as
// the Answer flow (prefilled from this email where exact). It does not link the email; Answer does that.

import React, { useState } from "react";
import { Button, Dialog, DialogContent, DialogTitle, IconButton, Stack, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import AddIcon from "@mui/icons-material/Add";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import { toast } from "react-toastify";
import { ShipmentDrawer, type DrawerMode } from "./ShipmentDrawer";
import type { InboxLang, InboxMessage } from "../../_lib/api";
import { resultBox } from "../../_lib/inbox-cards";
import { fromParts, whenShort } from "../../_lib/inbox-threads";
import { EmailView } from "./EmailView";
import { ResultBoxView } from "./InboxDetails";

export function EmailDialog({ message, lang, open, onClose }: { message: InboxMessage | null; lang: InboxLang; open: boolean; onClose: () => void }) {
  const m = message;
  const from = m ? `${fromParts(m.from).name}${m.company ? ` (${m.company})` : ""}` : "";
  const [drawer, setDrawer] = useState<DrawerMode | null>(null);
  const linkedShipment = m?.linked?.shipmentId ? { id: m.linked.shipmentId, ref: m.linked.ref ?? "" } : null;
  const ja = lang === "ja";
  return (
    <Dialog open={open && !!m} onClose={onClose} maxWidth="md" fullWidth transitionDuration={{ enter: 225, exit: 0 }} disableRestoreFocus data-tour="email-popup">
      <DialogTitle sx={{ pr: 7 }}>
        <Typography variant="h6" component="div" sx={{ fontWeight: 700, minWidth: 0, wordBreak: "break-word", overflowWrap: "anywhere" }}>
          {m?.subject || "(no subject)"}
        </Typography>
        {m && (
          <Typography variant="caption" color="text.secondary" component="div" sx={{ wordBreak: "break-word" }} title={m.from}>
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
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" data-tour="email-popup-shipment-actions">
              <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={() => setDrawer({ kind: "new" })} sx={{ textTransform: "none" }} data-tour="email-popup-new-shipment">
                {ja ? "新しい出荷…" : "New shipment…"}
              </Button>
              {linkedShipment && (
                <Button size="small" variant="outlined" startIcon={<EditOutlinedIcon />} onClick={() => setDrawer({ kind: "edit", shipmentId: linkedShipment.id })} sx={{ textTransform: "none" }} data-tour="email-popup-edit-shipment">
                  {ja ? `${linkedShipment.ref} を編集` : `Edit ${linkedShipment.ref}`}
                </Button>
              )}
            </Stack>
            <EmailView id={m.id} compactHeaders company={m.company ?? null} lang={lang} />
          </Stack>
        )}
      </DialogContent>
      {m && (
        <ShipmentDrawer
          open={!!drawer}
          mode={drawer}
          emailIds={[m.id]}
          lang={lang}
          onClose={() => setDrawer(null)}
          onSaved={(s) => toast.success(drawer?.kind === "new" ? (ja ? `${s.ref ?? "出荷"} を作成しました（メールの紐付けは「回答」で）` : `${s.ref ?? "Shipment"} created — link the email with Answer`) : ja ? `${s.ref ?? "出荷"} を保存しました` : `${s.ref ?? "Shipment"} saved`)}
        />
      )}
    </Dialog>
  );
}
