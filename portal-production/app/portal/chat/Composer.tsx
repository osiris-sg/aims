"use client";

import React, { useRef, useState } from "react";
import { Box, Chip, IconButton, InputBase, Stack, Tooltip, Typography } from "@mui/material";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import ArrowUpwardRoundedIcon from "@mui/icons-material/ArrowUpwardRounded";
import StopRoundedIcon from "@mui/icons-material/StopRounded";
import CloseIcon from "@mui/icons-material/Close";
import type { SendInput } from "./useOperatorChat";
import AimeeFace, { type AimeeMood } from "./AimeeFace";

// AIMEE's eye colour, used for every live accent on the box.
const CYAN = "85,233,255";

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
  /** True while the user has the box focused with something typed (AIMEE listens). */
  onTyping?: (active: boolean) => void;
}

export default function Composer({ disabled, sending, placeholder, onSend, onStop, onTyping }: Props) {
  const [text, setTextState] = useState("");
  const [focused, setFocused] = useState(false);
  const setText = (v: string) => {
    setTextState(v);
    onTyping?.(focused && v.trim().length > 0);
  };
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

  // The face in the box is the one the user looks at while typing.
  const mood: AimeeMood = sending ? "thinking" : focused && text.trim() ? "listening" : "idle";

  return (
    <Box sx={{ px: { xs: 2, md: 3 }, pb: 1.5, pt: 1 }}>
      <Box
        data-tour="chat-composer"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          pick(e.dataTransfer.files);
        }}
        sx={{
          position: "relative",
          border: "1px solid",
          borderColor: focused ? `rgba(${CYAN},0.7)` : `rgba(${CYAN},0.22)`,
          borderRadius: 7,
          bgcolor: (t) => (t.palette.mode === "dark" ? "rgba(255,255,255,0.035)" : "rgba(255,255,255,0.85)"),
          backdropFilter: "blur(10px)",
          boxShadow: (t) =>
            focused
              ? `0 0 0 4px rgba(${CYAN},0.12), 0 10px 32px rgba(${CYAN},${t.palette.mode === "dark" ? 0.12 : 0.18})`
              : t.palette.mode === "dark"
                ? "0 6px 24px rgba(0,0,0,0.35)"
                : "0 6px 24px rgba(16,24,40,0.07)",
          px: 1.25,
          py: 0.75,
          transition: "border-color .2s, box-shadow .25s",
          // A ring breathes out of the box while AIMEE works on the message.
          "&::after": {
            content: '""',
            position: "absolute",
            inset: -1,
            borderRadius: "inherit",
            pointerEvents: "none",
            border: `2px solid rgba(${CYAN},0.55)`,
            opacity: 0,
            animation: sending ? "aimeeWorking 1.5s ease-out infinite" : "none",
          },
          "@keyframes aimeeWorking": {
            "0%": { opacity: 0.8, transform: "scale(1)" },
            "100%": { opacity: 0, transform: "scale(1.035, 1.25)" },
          },
          "@media (prefers-reduced-motion: reduce)": { "&::after": { animation: "none" } },
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
        <Stack direction="row" alignItems="center" gap={1}>
          <Box sx={{ alignSelf: "flex-end", pb: 0.25, pl: 0.25 }}>
            <AimeeFace size={30} mood={mood} />
          </Box>
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
            placeholder={placeholder || "Tell AIMEE what you need…"}
            onChange={(e) => setText(e.target.value)}
            onFocus={() => {
              setFocused(true);
              onTyping?.(text.trim().length > 0);
            }}
            onBlur={() => {
              setFocused(false);
              onTyping?.(false);
            }}
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
            sx={{ fontSize: "0.95rem", py: 0.75, flex: 1 }}
          />
          <Tooltip title="Attach photos or PDFs (invoices, a price list). Up to 5 at once.">
            <span>
              <IconButton size="small" disabled={disabled || sending} onClick={() => fileRef.current?.click()} aria-label="Attach files" sx={{ color: "text.secondary" }}>
                <AttachFileIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
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
                width: 36,
                height: 36,
                color: "#06202a",
                backgroundImage: `linear-gradient(135deg, rgb(${CYAN}) 0%, #2bb8d6 100%)`,
                boxShadow: `0 4px 14px rgba(${CYAN},0.35)`,
                transition: "transform .15s, box-shadow .15s",
                "&:hover": { transform: "translateY(-1px)", boxShadow: `0 6px 18px rgba(${CYAN},0.5)` },
                "&.Mui-disabled": { backgroundImage: "none", bgcolor: "action.disabledBackground", color: "action.disabled", boxShadow: "none" },
              }}
            >
              <ArrowUpwardRoundedIcon fontSize="small" />
            </IconButton>
          )}
        </Stack>
      </Box>
      <Typography sx={{ mt: 0.75, fontSize: "0.68rem", color: fileError ? "error.main" : "text.secondary", opacity: fileError ? 1 : 0.7, textAlign: "center" }}>
        {fileError || "Enter to send · Shift+Enter for a new line · anything final asks you first"}
      </Typography>
    </Box>
  );
}
