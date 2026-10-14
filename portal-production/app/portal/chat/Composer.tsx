"use client";

import React, { useRef, useState } from "react";
import { Box, Chip, IconButton, InputBase, Stack, Tooltip, Typography } from "@mui/material";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import ArrowUpwardRoundedIcon from "@mui/icons-material/ArrowUpwardRounded";
import StopRoundedIcon from "@mui/icons-material/StopRounded";
import CloseIcon from "@mui/icons-material/Close";
import type { SendInput } from "./useOperatorChat";

const MAX_MB = 15;
// The API body limit is 15 MB, so a batch has to fit under it as a whole.
const MAX_TOTAL_MB = 14;
const MAX_FILES = 5;

type Picked = { dataUri: string; mimetype: string; filename: string; size: number };

interface Props {
  disabled?: boolean;
  sending: boolean;
  placeholder?: string;
  onSend: (input: SendInput) => void;
  onStop: () => void;
}

export default function Composer({ disabled, sending, placeholder, onSend, onStop }: Props) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<Picked[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Several files at once: a drop of three invoices or a multi-select in the
  // picker (guru 2026-10-15: "i cant upload more than one").
  const pick = (list: FileList | File[] | null | undefined) => {
    setFileError(null);
    const incoming = Array.from(list || []);
    if (!incoming.length) return;
    const accepted: File[] = [];
    let total = files.reduce((s, f) => s + f.size, 0);
    for (const f of incoming) {
      if (files.length + accepted.length >= MAX_FILES) {
        setFileError(`Up to ${MAX_FILES} files per message.`);
        break;
      }
      if (!/^(image\/|application\/pdf)/.test(f.type)) {
        setFileError(`${f.name}: send a photo or a PDF.`);
        continue;
      }
      if (f.size > MAX_MB * 1024 * 1024) {
        setFileError(`${f.name} is over ${MAX_MB} MB.`);
        continue;
      }
      if (total + f.size > MAX_TOTAL_MB * 1024 * 1024) {
        setFileError(`Together the files are over ${MAX_TOTAL_MB} MB. Send them in two messages.`);
        break;
      }
      if (files.some((x) => x.filename === f.name && x.size === f.size)) continue;
      total += f.size;
      accepted.push(f);
    }
    accepted.forEach((f) => {
      const reader = new FileReader();
      reader.onload = () =>
        setFiles((prev) =>
          prev.length >= MAX_FILES || prev.some((x) => x.filename === f.name && x.size === f.size)
            ? prev
            : [...prev, { dataUri: String(reader.result), mimetype: f.type, filename: f.name, size: f.size }],
        );
      reader.readAsDataURL(f);
    });
  };

  const submit = () => {
    if (sending || disabled) return;
    const t = text.trim();
    if (!t && !files.length) return;
    onSend({ text: t, attachments: files.length ? files.map(({ dataUri, mimetype, filename }) => ({ dataUri, mimetype, filename })) : undefined });
    setText("");
    setFiles([]);
  };

  return (
    <Box sx={{ px: { xs: 2, md: 3 }, pb: 2, pt: 1 }}>
      <Box
        data-tour="chat-composer"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          pick(e.dataTransfer.files);
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
        {!!files.length && (
          <Stack direction="row" flexWrap="wrap" gap={0.75} sx={{ mb: 1 }}>
            {files.map((f) => (
              <Chip
                key={`${f.filename}-${f.size}`}
                size="small"
                label={f.filename}
                onDelete={() => setFiles((prev) => prev.filter((x) => x !== f))}
                deleteIcon={<CloseIcon />}
                sx={{ maxWidth: 260 }}
              />
            ))}
          </Stack>
        )}
        <Stack direction="row" alignItems="flex-end" gap={1}>
          <Tooltip title="Attach photos or PDFs (invoices, a price list). Up to 5 at once.">
            <span>
              <IconButton size="small" disabled={disabled || sending} onClick={() => fileRef.current?.click()} aria-label="Attach files">
                <AttachFileIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <input
            ref={fileRef}
            type="file"
            hidden
            multiple
            accept="image/*,application/pdf"
            onChange={(e) => {
              pick(e.target.files);
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
            onPaste={(e) => {
              // Pasted screenshots land as files, like in any chat app.
              const items = Array.from(e.clipboardData?.files || []);
              if (items.length) {
                e.preventDefault();
                pick(items);
              }
            }}
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
              disabled={disabled || (!text.trim() && !files.length)}
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
