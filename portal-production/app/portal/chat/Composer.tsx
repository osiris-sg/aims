"use client";

import React, { useRef, useState } from "react";
import { Box, Chip, IconButton, InputBase, Stack, Tooltip, Typography } from "@mui/material";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import ArrowUpwardRoundedIcon from "@mui/icons-material/ArrowUpwardRounded";
import StopRoundedIcon from "@mui/icons-material/StopRounded";
import CloseIcon from "@mui/icons-material/Close";
import type { SendInput } from "./useOperatorChat";

const MAX_MB = 15;

interface Props {
  disabled?: boolean;
  sending: boolean;
  placeholder?: string;
  onSend: (input: SendInput) => void;
  onStop: () => void;
}

export default function Composer({ disabled, sending, placeholder, onSend, onStop }: Props) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<{ dataUri: string; mimetype: string; filename: string } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const pick = (f: File | undefined) => {
    setFileError(null);
    if (!f) return;
    if (f.size > MAX_MB * 1024 * 1024) {
      setFileError(`That file is over ${MAX_MB} MB.`);
      return;
    }
    if (!/^(image\/|application\/pdf)/.test(f.type)) {
      setFileError("Send a photo or a PDF.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setFile({ dataUri: String(reader.result), mimetype: f.type, filename: f.name });
    reader.readAsDataURL(f);
  };

  const submit = () => {
    if (sending || disabled) return;
    const t = text.trim();
    if (!t && !file) return;
    onSend({ text: t, attachment: file || undefined });
    setText("");
    setFile(null);
  };

  return (
    <Box sx={{ px: { xs: 2, md: 3 }, pb: 2, pt: 1 }}>
      <Box
        data-tour="chat-composer"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          pick(e.dataTransfer.files?.[0]);
        }}
        sx={{
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 4,
          bgcolor: "background.paper",
          boxShadow: (t) => (t.palette.mode === "dark" ? "0 2px 12px rgba(0,0,0,0.35)" : "0 2px 12px rgba(0,0,0,0.06)"),
          px: 1.5,
          py: 1,
          "&:focus-within": { borderColor: "primary.main" },
        }}
      >
        {file && (
          <Chip
            size="small"
            label={file.filename}
            onDelete={() => setFile(null)}
            deleteIcon={<CloseIcon />}
            sx={{ mb: 1, maxWidth: "100%" }}
          />
        )}
        <Stack direction="row" alignItems="flex-end" gap={1}>
          <Tooltip title="Attach a photo or PDF (an invoice, a price list)">
            <span>
              <IconButton size="small" disabled={disabled || sending} onClick={() => fileRef.current?.click()} aria-label="Attach file">
                <AttachFileIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <input
            ref={fileRef}
            type="file"
            hidden
            accept="image/*,application/pdf"
            onChange={(e) => {
              pick(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <InputBase
            multiline
            maxRows={8}
            fullWidth
            autoFocus
            value={text}
            disabled={disabled}
            placeholder={placeholder || "Ask AIMS anything, or tell it what to do…"}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            inputProps={{ "aria-label": "Message", "data-tour": "chat-input" }}
            sx={{ fontSize: "0.95rem", py: 0.5, flex: 1 }}
          />
          {sending ? (
            <Tooltip title="Stop">
              <IconButton size="small" onClick={onStop} sx={{ bgcolor: "text.primary", color: "background.paper", "&:hover": { bgcolor: "text.secondary" } }} aria-label="Stop">
                <StopRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          ) : (
            <IconButton
              size="small"
              onClick={submit}
              disabled={disabled || (!text.trim() && !file)}
              aria-label="Send"
              sx={{
                bgcolor: "primary.main",
                color: "primary.contrastText",
                "&:hover": { bgcolor: "primary.dark" },
                "&.Mui-disabled": { bgcolor: "action.disabledBackground", color: "action.disabled" },
              }}
            >
              <ArrowUpwardRoundedIcon fontSize="small" />
            </IconButton>
          )}
        </Stack>
      </Box>
      <Typography sx={{ mt: 0.75, fontSize: "0.7rem", color: fileError ? "error.main" : "text.secondary", textAlign: "center" }}>
        {fileError || "Enter to send, Shift+Enter for a new line. Anything final asks you to confirm first."}
      </Typography>
    </Box>
  );
}
