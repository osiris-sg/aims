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
import { useTranslations } from "next-intl";
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
  const t = useTranslations("inbox.emailDialog");
  return (
    <Dialog open={open && !!m} onClose={onClose} maxWidth="md" fullWidth transitionDuration={{ enter: 225, exit: 0 }} disableRestoreFocus data-tour="email-popup">
      <DialogTitle sx={{ pr: 7 }}>
        <Typography variant="h6" component="div" sx={{ fontWeight: 700, minWidth: 0, wordBreak: "break-word", overflowWrap: "anywhere" }}>
          {m?.subject || t("noSubject")}
        </Typography>
        {m && (
          <Typography variant="caption" color="text.secondary" component="div" sx={{ wordBreak: "break-word" }} title={m.from}>
            {t("from", { from })} · {whenShort(m.date, lang)}
          </Typography>
        )}
        <IconButton aria-label={t("close")} onClick={onClose} sx={{ position: "absolute", right: 8, top: 8 }} data-tour="email-dialog-close">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {m && (
          <Stack spacing={1.5}>
            <ResultBoxView r={resultBox(m, lang)} lang={lang} />
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" data-tour="email-popup-shipment-actions">
              <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={() => setDrawer({ kind: "new" })} sx={{ textTransform: "none" }} data-tour="email-popup-new-shipment">
                {t("newShipment")}
              </Button>
              {linkedShipment && (
                <Button size="small" variant="outlined" startIcon={<EditOutlinedIcon />} onClick={() => setDrawer({ kind: "edit", shipmentId: linkedShipment.id })} sx={{ textTransform: "none" }} data-tour="email-popup-edit-shipment">
                  {t("editRef", { ref: linkedShipment.ref })}
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
          onSaved={(s) => toast.success(drawer?.kind === "new" ? t("created", { ref: s.ref ?? t("shipment") }) : t("saved", { ref: s.ref ?? t("shipment") }))}
        />
      )}
    </Dialog>
  );
}
