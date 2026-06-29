/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Drawer,
  IconButton,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
  alpha,
} from "@mui/material";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import SendIcon from "@mui/icons-material/Send";
import CloseIcon from "@mui/icons-material/Close";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import CheckIcon from "@mui/icons-material/Check";
import { useAuth } from "@clerk/nextjs";
import { toast } from "react-toastify";
import { request } from "@/helpers/request";

// Proposal patch shape — mirrors the backend ProposalPatch.
export type ProposalPatch = {
  documentInfo?: Record<string, any>;
  customer?: Record<string, any>;
  items?: Array<{
    description?: string;
    quantity?: number;
    unitPrice?: number;
    uom?: string;
    tax?: number | string;
  }>;
  note?: string;
  termsAndConditions?: string;
  footerMessage?: string;
};

type Source = { documentId: string; name: string | null; type: string };

type Turn = {
  role: "user" | "assistant";
  content: string;
  proposal?: ProposalPatch | null;
  sources?: Source[];
  files?: string[]; // file names attached to a user turn
};

type PendingFile = { name: string; mediaType: string; base64: string };

interface Props {
  open: boolean;
  onClose: () => void;
  documentType: string;
  documentId?: string;
  formData: any;
  items: any[];
  organization?: any;
  // Apply a (subset of a) proposal into the editor form.
  onApplyProposal: (patch: ProposalPatch) => void;
}

const SUGGESTIONS = [
  "Write a clear description for what this document is for",
  "Fill this in the same style as the last one for this customer",
  "Draft line items and a short client-friendly summary",
];

function fileToBase64(file: File): Promise<PendingFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      resolve({ name: file.name, mediaType: file.type || "application/octet-stream", base64 });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function DocumentAssistantDrawer({
  open,
  onClose,
  documentType,
  documentId,
  formData,
  items,
  organization,
  onApplyProposal,
}: Props) {
  const { getToken } = useAuth();
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length, loading]);

  const customerId = formData?.customer?.id || "";

  const submit = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      if ((!trimmed && pendingFiles.length === 0) || loading) return;
      setLoading(true);

      const filesForTurn = pendingFiles.map((f) => f.name);
      const userTurn: Turn = { role: "user", content: trimmed, files: filesForTurn };
      // Only prior conversation (text) is sent as history.
      const history = turns.map((t) => ({ role: t.role, content: t.content }));
      setTurns((prev) => [...prev, userTurn]);
      setInput("");
      const attachments = pendingFiles;
      setPendingFiles([]);

      try {
        const token = await getToken();
        const res: any = await request(
          { path: "/document-assistant/chat", method: "POST" },
          {
            documentType,
            documentId,
            customerId,
            message: trimmed || "Please use the attached file to fill in this document.",
            draft: { formData, items },
            history,
            attachments,
          },
          token ?? undefined,
        );

        const result = res?.success ? res.data : res;
        if (!result || (res && res.success === false)) {
          throw new Error(res?.message || "Assistant failed");
        }

        setTurns((prev) => [
          ...prev,
          {
            role: "assistant",
            content: result.answer || "",
            proposal: result.proposal || null,
            sources: result.sources || [],
          },
        ]);
      } catch (e: any) {
        toast.error(e?.message || "Assistant failed");
        setTurns((prev) => [
          ...prev,
          { role: "assistant", content: "Sorry — something went wrong. Please try again." },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [pendingFiles, loading, turns, getToken, documentType, documentId, customerId, formData, items],
  );

  const onPickFiles = useCallback(async (fileList: FileList | null) => {
    if (!fileList?.length) return;
    const accepted = Array.from(fileList).filter((f) =>
      /^(image\/|application\/pdf)/.test(f.type),
    );
    if (accepted.length < fileList.length) {
      toast.error("Only images and PDF files are supported.");
    }
    try {
      const converted = await Promise.all(accepted.map(fileToBase64));
      setPendingFiles((prev) => [...prev, ...converted]);
    } catch {
      toast.error("Could not read the selected file.");
    }
  }, []);

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      // Keep the editor fully usable while the panel is open: no backdrop, no
      // focus trap, no scroll lock, and let clicks pass through the modal root
      // (pointerEvents:none) everywhere except the panel itself.
      hideBackdrop
      ModalProps={{ keepMounted: true, disableEnforceFocus: true, disableScrollLock: true }}
      sx={{
        pointerEvents: "none",
        "& .MuiDrawer-paper": {
          pointerEvents: "auto",
          width: { xs: "100%", sm: 440 },
          backgroundColor: "background.paper",
          backgroundImage: "none",
          borderLeft: 1,
          borderColor: "divider",
          display: "flex",
          flexDirection: "column",
          boxShadow: 6,
        },
      }}
    >
      {/* Header */}
      <Box
        sx={{
          px: 2,
          py: 1.5,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <Stack direction="row" alignItems="center" gap={1}>
          <AutoAwesomeIcon sx={{ color: "primary.main", fontSize: "1.25rem" }} />
          <Typography sx={{ fontWeight: 700 }}>AI Assistant</Typography>
        </Stack>
        <Stack direction="row" gap={0.5}>
          {turns.length > 0 && (
            <Tooltip title="Clear conversation">
              <IconButton size="small" onClick={() => setTurns([])} disabled={loading}>
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          <IconButton size="small" onClick={onClose}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>
      </Box>

      {/* Conversation */}
      <Box sx={{ flex: 1, overflowY: "auto", p: 2 }}>
        {turns.length === 0 && (
          <Stack gap={1.5} sx={{ color: "text.secondary" }}>
            <Typography variant="body2">
              Ask me to help fill in this {documentType} — write descriptions, draft line items,
              pull details from a past document, or extract from an uploaded file. I’ll suggest
              values you can review and apply.
            </Typography>
            <Stack gap={0.75}>
              {SUGGESTIONS.map((s) => (
                <Chip
                  key={s}
                  label={s}
                  size="small"
                  variant="outlined"
                  onClick={() => submit(s)}
                  sx={{
                    cursor: "pointer",
                    height: "auto",
                    "& .MuiChip-label": { whiteSpace: "normal", py: 0.5 },
                    justifyContent: "flex-start",
                  }}
                />
              ))}
            </Stack>
          </Stack>
        )}

        <Stack gap={2}>
          {turns.map((turn, i) => (
            <TurnView key={i} turn={turn} onApply={onApplyProposal} />
          ))}
          {loading && (
            <Stack direction="row" gap={1} alignItems="center" sx={{ color: "text.secondary" }}>
              <CircularProgress size={14} />
              <Typography variant="body2">Thinking…</Typography>
            </Stack>
          )}
          <div ref={scrollRef} />
        </Stack>
      </Box>

      {/* Pending file chips */}
      {pendingFiles.length > 0 && (
        <Box sx={{ px: 2, pt: 1 }}>
          <Stack direction="row" gap={0.75} flexWrap="wrap">
            {pendingFiles.map((f, i) => (
              <Chip
                key={i}
                label={f.name}
                size="small"
                onDelete={() => setPendingFiles((prev) => prev.filter((_, j) => j !== i))}
              />
            ))}
          </Stack>
        </Box>
      )}

      {/* Input */}
      <Box sx={{ p: 1.5, borderTop: 1, borderColor: "divider" }}>
        <Stack direction="row" alignItems="flex-end" gap={1}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf"
            multiple
            hidden
            onChange={(e) => {
              onPickFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <Tooltip title="Attach a document (PDF or image)">
            <IconButton size="small" onClick={() => fileInputRef.current?.click()} disabled={loading}>
              <AttachFileIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <TextField
            fullWidth
            size="small"
            multiline
            maxRows={4}
            placeholder="Ask the assistant…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(input);
              }
            }}
            disabled={loading}
          />
          <Button
            variant="contained"
            onClick={() => submit(input)}
            disabled={loading || (!input.trim() && pendingFiles.length === 0)}
            sx={{ minWidth: 0, px: 1.5 }}
          >
            {loading ? <CircularProgress size={16} color="inherit" /> : <SendIcon fontSize="small" />}
          </Button>
        </Stack>
      </Box>
    </Drawer>
  );
}

function TurnView({ turn, onApply }: { turn: Turn; onApply: (p: ProposalPatch) => void }) {
  const isUser = turn.role === "user";
  return (
    <Box>
      <Stack direction="row" gap={1} alignItems="flex-start">
        <Box
          sx={{
            width: 24,
            height: 24,
            borderRadius: "50%",
            flexShrink: 0,
            mt: 0.25,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "0.65rem",
            fontWeight: 700,
            bgcolor: (t) =>
              isUser ? alpha(t.palette.text.primary, 0.08) : alpha(t.palette.primary.main, 0.12),
            color: isUser ? "text.primary" : "primary.main",
          }}
        >
          {isUser ? "You" : <AutoAwesomeIcon sx={{ fontSize: "0.875rem" }} />}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {turn.content && (
            <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", fontWeight: isUser ? 500 : 400 }}>
              {isUser ? turn.content : renderInlineMarkdown(turn.content)}
            </Typography>
          )}
          {turn.files && turn.files.length > 0 && (
            <Stack direction="row" gap={0.5} flexWrap="wrap" sx={{ mt: 0.5 }}>
              {turn.files.map((f, i) => (
                <Chip key={i} label={f} size="small" icon={<AttachFileIcon />} />
              ))}
            </Stack>
          )}
          {turn.proposal && <ProposalCard patch={turn.proposal} onApply={onApply} />}
          {turn.sources && turn.sources.length > 0 && (
            <Typography variant="caption" sx={{ display: "block", color: "text.secondary", mt: 1 }}>
              Based on: {turn.sources.map((s) => s.name || s.type).join(", ")}
            </Typography>
          )}
        </Box>
      </Stack>
    </Box>
  );
}

// Renders the proposed fields grouped by section, each independently applicable.
function ProposalCard({ patch, onApply }: { patch: ProposalPatch; onApply: (p: ProposalPatch) => void }) {
  const [applied, setApplied] = useState<Record<string, boolean>>({});

  const sections: Array<{ key: string; label: string; render: React.ReactNode; payload: ProposalPatch }> = [];

  if (patch.items && patch.items.length) {
    sections.push({
      key: "items",
      label: `${patch.items.length} line item${patch.items.length > 1 ? "s" : ""}`,
      payload: { items: patch.items },
      render: (
        <Stack gap={0.5}>
          {patch.items.map((it, i) => (
            <Typography key={i} variant="body2" sx={{ fontSize: "0.8rem" }}>
              • {stripHtml(it.description || "")}
              {it.quantity != null ? `  ×${it.quantity}` : ""}
              {it.unitPrice != null ? `  @ ${it.unitPrice}` : ""}
            </Typography>
          ))}
        </Stack>
      ),
    });
  }
  if (patch.documentInfo && Object.keys(patch.documentInfo).length) {
    sections.push({
      key: "documentInfo",
      label: "Document details",
      payload: { documentInfo: patch.documentInfo },
      render: <KeyVals obj={patch.documentInfo} />,
    });
  }
  if (patch.customer && Object.keys(patch.customer).length) {
    sections.push({
      key: "customer",
      label: "Customer",
      payload: { customer: patch.customer },
      render: <KeyVals obj={patch.customer} />,
    });
  }
  const noteParts: ProposalPatch = {};
  if (patch.note) noteParts.note = patch.note;
  if (patch.termsAndConditions) noteParts.termsAndConditions = patch.termsAndConditions;
  if (patch.footerMessage) noteParts.footerMessage = patch.footerMessage;
  if (Object.keys(noteParts).length) {
    sections.push({
      key: "notes",
      label: "Notes & terms",
      payload: noteParts,
      render: (
        <Stack gap={0.5}>
          {patch.note && <Typography variant="body2" sx={{ fontSize: "0.8rem" }}>{stripHtml(patch.note)}</Typography>}
          {patch.termsAndConditions && (
            <Typography variant="caption" color="text.secondary">{stripHtml(patch.termsAndConditions)}</Typography>
          )}
        </Stack>
      ),
    });
  }

  if (!sections.length) return null;

  const applyOne = (key: string, payload: ProposalPatch) => {
    onApply(payload);
    setApplied((prev) => ({ ...prev, [key]: true }));
  };
  const applyAll = () => {
    onApply(patch);
    const all: Record<string, boolean> = {};
    sections.forEach((s) => (all[s.key] = true));
    setApplied(all);
  };

  return (
    <Paper variant="outlined" sx={{ mt: 1, borderRadius: 1.5, borderLeft: 3, borderLeftColor: "primary.main" }}>
      <Box sx={{ px: 1.5, py: 1, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Typography variant="caption" sx={{ fontWeight: 700, textTransform: "uppercase", color: "text.secondary" }}>
          Suggested
        </Typography>
        <Button size="small" variant="contained" onClick={applyAll} sx={{ minWidth: 0, py: 0.25 }}>
          Apply all
        </Button>
      </Box>
      <Divider />
      <Stack divider={<Divider />}>
        {sections.map((s) => (
          <Box key={s.key} sx={{ px: 1.5, py: 1 }}>
            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 0.5 }}>
              <Typography variant="caption" sx={{ fontWeight: 600 }}>{s.label}</Typography>
              <Button
                size="small"
                variant={applied[s.key] ? "text" : "outlined"}
                color={applied[s.key] ? "success" : "primary"}
                onClick={() => applyOne(s.key, s.payload)}
                startIcon={applied[s.key] ? <CheckIcon sx={{ fontSize: "0.9rem !important" }} /> : undefined}
                sx={{ minWidth: 0, py: 0, fontSize: "0.7rem" }}
              >
                {applied[s.key] ? "Applied" : "Apply"}
              </Button>
            </Box>
            {s.render}
          </Box>
        ))}
      </Stack>
    </Paper>
  );
}

function KeyVals({ obj }: { obj: Record<string, any> }) {
  return (
    <Stack gap={0.25}>
      {Object.entries(obj)
        .filter(([, v]) => v != null && v !== "")
        .map(([k, v]) => (
          <Typography key={k} variant="body2" sx={{ fontSize: "0.8rem" }}>
            <Box component="span" sx={{ color: "text.secondary" }}>{k}: </Box>
            {String(v)}
          </Typography>
        ))}
    </Stack>
  );
}

function stripHtml(s: string): string {
  return String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// Tiny inline-markdown renderer: **bold**, *italic*, `code`, and bare URLs.
// Processes each line independently so newlines from pre-wrap still work.
function renderInlineMarkdown(text: string): React.ReactNode {
  if (!text) return null;
  const pattern = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`|https?:\/\/[^\s)]+)/g;
  const lines = text.split("\n");
  return lines.map((line, lineIdx) => {
    const parts: React.ReactNode[] = [];
    let lastIdx = 0;
    let m: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((m = pattern.exec(line)) !== null) {
      if (m.index > lastIdx) parts.push(line.slice(lastIdx, m.index));
      const token = m[0];
      if (token.startsWith("**") && token.endsWith("**")) {
        parts.push(
          <Box component="strong" key={`b${m.index}`} sx={{ fontWeight: 700 }}>
            {token.slice(2, -2)}
          </Box>,
        );
      } else if (token.startsWith("*") && token.endsWith("*")) {
        parts.push(
          <Box component="em" key={`i${m.index}`} sx={{ fontStyle: "italic" }}>
            {token.slice(1, -1)}
          </Box>,
        );
      } else if (token.startsWith("`") && token.endsWith("`")) {
        parts.push(
          <Box
            component="code"
            key={`c${m.index}`}
            sx={{ fontFamily: "monospace", fontSize: "0.85em", px: 0.5, py: 0.125, borderRadius: 0.5, bgcolor: (t) => alpha(t.palette.text.primary, 0.06) }}
          >
            {token.slice(1, -1)}
          </Box>,
        );
      } else if (/^https?:\/\//.test(token)) {
        parts.push(
          <a key={`u${m.index}`} href={token} target="_blank" rel="noopener noreferrer">
            {token}
          </a>,
        );
      } else {
        parts.push(token);
      }
      lastIdx = m.index + token.length;
    }
    if (lastIdx < line.length) parts.push(line.slice(lastIdx));
    return (
      <span key={lineIdx}>
        {parts}
        {lineIdx < lines.length - 1 ? "\n" : null}
      </span>
    );
  });
}
