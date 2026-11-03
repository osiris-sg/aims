"use client";

// Drop-zone fixture: no API. Served only with PREVIEW_FIXTURES=1.
import React, { useMemo, useState } from "react";
import { Box, CssBaseline, Paper, Typography } from "@mui/material";
import { ThemeProvider, alpha } from "@mui/material/styles";
import { ToastContainer } from "react-toastify";
import lightTheme from "@/themes/lightTheme";
import darkTheme from "@/themes/darkTheme";
import { useFileDrop } from "@/hooks/useFileDrop";
import { UPLOAD_ACCEPT } from "@/helpers/uploadExpand";
import AttachmentUploader, { type Attachment } from "@/components/AttachmentUploader";

export default function PreviewClient({ mode }: { mode: "light" | "dark" }) {
  const theme = useMemo(() => (mode === "dark" ? darkTheme : lightTheme), [mode]);
  const [got, setGot] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const drop = useFileDrop({ accept: UPLOAD_ACCEPT, onFiles: (fs) => setGot((g) => [...g, ...fs.map((f) => f.name)]) });
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <ToastContainer />
      <Box sx={{ p: 3, maxWidth: 820, mx: "auto", bgcolor: "background.default", minHeight: "100vh" }}>
        <Paper
          variant="outlined"
          {...drop.bind}
          data-testid="sin-drop-zone"
          sx={{
            p: 1.5,
            mb: 3,
            borderStyle: "dashed",
            borderWidth: drop.dragOver ? 2 : 1,
            borderColor: (t: any) => (drop.dragOver ? t.palette.primary.main : alpha(t.palette.primary.main, 0.4)),
            bgcolor: (t: any) => alpha(t.palette.primary.main, drop.dragOver ? 0.12 : 0.03),
          }}
        >
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {drop.dragOver ? "Drop to extract." : "Drop PDFs or images of supplier invoices here, and Claude will extract them for you."}
          </Typography>
          <Typography variant="caption" data-testid="sin-got">
            {got.join(", ")}
          </Typography>
        </Paper>
        <AttachmentUploader folder="preview" value={attachments} onChange={setAttachments} label="Source Documents" />
      </Box>
    </ThemeProvider>
  );
}
