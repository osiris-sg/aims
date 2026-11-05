"use client";

// Round BF (Sayaka) — under a filed document on a shipment slot: an email brought a NEWER version of it (same file
// name, other bytes): "Newer version received 27/10 13:10 · Replace?" with preview and Compare. Never replaced by
// itself — Replace files the newer one on the same step / slot and hides the old link (kept, not deleted).

import React, { useState } from "react";
import { Box, Button, Stack, Typography } from "@mui/material";
import FiberNewIcon from "@mui/icons-material/FiberNew";
import { useTranslations } from "next-intl";
import { useUiLang } from "@/i18n/UiLangProvider";
import { useShipmentsApi, type NewerVersion, type RecordFileLink } from "../_lib/api";
import { useTradeMutation } from "../_lib/hooks";
import { dmHm } from "../_lib/file-versions";
import { toast } from "../_lib/toast";
import { ConfirmDialog } from "./bits";
import { AttachmentRow, type AttachmentView } from "./inbox/AttachmentRow";

export default function NewerVersionLine({ item, link, canReplace }: { item: NewerVersion; link: RecordFileLink; canReplace: boolean }) {
  const t = useTranslations("inbox.fileVersions");
  const { lang } = useUiLang();
  const api = useShipmentsApi();
  const [ask, setAsk] = useState(false);
  const replace = useTradeMutation((a, b: { linkId: string; emailId: string; index: number }) => a.replaceWithNewer(b));
  const at = dmHm(item.newer.date, lang);
  const newer: AttachmentView = {
    key: `${item.newer.emailId}:${item.newer.index}`,
    name: item.newer.name,
    size: item.newer.size,
    pages: item.newer.pages,
    date: item.newer.date,
    from: item.newer.from,
    company: item.newer.company,
    version: { versions: 2, latest: true, olderAt: null, identicalTo: null },
    getUrl: async () => (await api.inboxAttachmentUrl(item.newer.emailId, item.newer.index)).url,
  };
  const current: AttachmentView = {
    key: `file:${link.file.id}`,
    name: link.file.fileName,
    contentType: link.file.mimeType,
    date: item.linkedAt,
    version: { versions: 2, latest: false, olderAt: item.linkedAt, identicalTo: null },
    getUrl: async () => (await api.fileUrl(link.file.id)).url,
  };
  return (
    <Box sx={{ mt: 0.75, p: 1, borderRadius: 1, border: "1px solid", borderColor: "warning.main", bgcolor: "action.hover" }} data-tour="slot-newer-version">
      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 0.5 }}>
        <FiberNewIcon fontSize="small" color="warning" />
        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          {t("newerSlot", { at })}
        </Typography>
        {canReplace && (
          <Button size="small" variant="contained" color="warning" onClick={() => setAsk(true)} sx={{ textTransform: "none", py: 0, ml: 0.5 }} data-tour="slot-newer-replace">
            {t("replace")}
          </Button>
        )}
      </Stack>
      <AttachmentRow f={newer} lang={lang} dense compareTo={current} />
      <ConfirmDialog
        open={ask}
        title={t("replaceTitle")}
        body={t("replaceBody", { at })}
        confirmLabel={t("replaceConfirm")}
        onClose={() => setAsk(false)}
        onConfirm={async () => {
          await replace.mutateAsync({ linkId: item.linkId, emailId: item.newer.emailId, index: item.newer.index });
          toast.success(t("replaced", { at }));
        }}
      />
    </Box>
  );
}
