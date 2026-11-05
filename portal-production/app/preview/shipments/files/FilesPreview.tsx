/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import React from "react";
import { Box, Paper, Stack, Typography } from "@mui/material";
import type { InboxLang } from "@/app/portal/shipments/_lib/api";
import { ThreadFiles } from "@/app/portal/shipments/_components/inbox/InboxDetails";
import NewerVersionLine from "@/app/portal/shipments/_components/NewerVersionLine";
import { FileUrlOverride } from "@/app/portal/shipments/_components/inbox/AttachmentRow";

/** The thread's file list and one slot with a newer version, from the fixture (round BF). */
export default function FilesPreview({ data, lang }: { data: any; lang: InboxLang }) {
  if (!data) return <Typography sx={{ p: 3 }}>No files fixture.</Typography>;
  // The fixture's `pdfBase` serves the files by "<emailId first 8>.pdf" (a filed file: `slot.filedAs`).
  const urlOf = (key: string) => (data.pdfBase ? `${data.pdfBase}/${(key.startsWith("file:") ? data.slot?.filedAs ?? "" : key).slice(0, 8)}.pdf` : null);
  return (
    <FileUrlOverride.Provider value={urlOf}>
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default", p: 2 }}>
      <Stack spacing={2} sx={{ maxWidth: 900, mx: "auto" }}>
        <Paper variant="outlined" sx={{ p: 2 }} data-tour="preview-thread-files">
          <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>{data.threadSubject}</Typography>
          <ThreadFiles files={data.thread ?? []} quotedMissing={0} lang={lang} />
        </Paper>
        {data.slot && (
          <Paper variant="outlined" sx={{ p: 2 }} data-tour="preview-slot">
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{data.slot.title}</Typography>
            <Typography variant="body2" sx={{ fontWeight: 600, mt: 1 }}>{data.slot.link.file.fileName}</Typography>
            <Typography variant="caption" color="text.secondary">{data.slot.filedLine}</Typography>
            <NewerVersionLine item={data.slot.item} link={data.slot.link} canReplace />
          </Paper>
        )}
      </Stack>
    </Box>
    </FileUrlOverride.Provider>
  );
}
