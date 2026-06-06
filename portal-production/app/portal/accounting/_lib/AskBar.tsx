"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
  alpha,
} from "@mui/material";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import SendIcon from "@mui/icons-material/Send";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import Link from "next/link";
import { toast } from "react-toastify";
import { useAccountingApi } from "./api";

type Attachment =
  | { type: "kpi"; label: string; value: string; sub?: string }
  | { type: "table"; title?: string; columns: string[]; rows: Array<Array<string | number>> }
  | { type: "link"; href: string; label: string };

type Turn = {
  question: string;
  answer: string;
  attachments: Attachment[];
  toolCalls: Array<{ name: string; input: any }>;
};

const SUGGESTIONS = [
  "What's my net profit this month?",
  "Show GST payable for this quarter",
  "Who do I owe money to?",
  "Recent journal entries this week",
  "Trial balance as of today",
];

export default function AskBar() {
  const { request } = useAccountingApi();
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to newest answer when a turn lands.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [turns.length]);

  const submit = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      if (!trimmed || loading) return;
      setLoading(true);
      try {
        const history = turns.flatMap((t) => [
          { role: "user" as const, content: t.question },
          { role: "assistant" as const, content: t.answer },
        ]);
        const res = await request<{ answer: string; attachments: Attachment[]; toolCalls: any[] }>(
          "/ask",
          {
            method: "POST",
            body: JSON.stringify({ question: trimmed, history }),
          },
        );
        setTurns((prev) => [
          ...prev,
          {
            question: trimmed,
            answer: res.answer,
            attachments: res.attachments || [],
            toolCalls: res.toolCalls || [],
          },
        ]);
        setQuestion("");
      } catch (e: any) {
        toast.error(e?.message || "Ask failed");
      } finally {
        setLoading(false);
      }
    },
    [loading, request, turns],
  );

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
      {/* Conversation */}
      {turns.length > 0 && (
        <Box sx={{ maxHeight: 480, overflowY: "auto", p: 2, pb: 1 }}>
          <Stack gap={2}>
            {turns.map((turn, i) => (
              <TurnView key={i} turn={turn} />
            ))}
            <div ref={scrollRef} />
          </Stack>
        </Box>
      )}

      {/* Input row */}
      <Box
        sx={{
          p: 1.5,
          borderTop: turns.length > 0 ? 1 : 0,
          borderColor: "divider",
          bgcolor: (t) => alpha(t.palette.primary.main, 0.02),
        }}
      >
        <Stack direction="row" alignItems="center" gap={1}>
          <AutoAwesomeIcon sx={{ color: "primary.main", fontSize: "1.125rem", ml: 0.5 }} />
          <TextField
            fullWidth
            size="small"
            placeholder="Ask anything about your books — try “Net profit MTD vs last month”"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(question);
              }
            }}
            disabled={loading}
            InputProps={{
              sx: { fontSize: "0.9375rem" },
            }}
          />
          <Button
            variant="contained"
            size="small"
            onClick={() => submit(question)}
            disabled={loading || !question.trim()}
            startIcon={loading ? <CircularProgress size={14} color="inherit" /> : <SendIcon />}
            sx={{ minWidth: 90 }}
          >
            {loading ? "Thinking" : "Ask"}
          </Button>
          {turns.length > 0 && (
            <IconButton size="small" onClick={() => setTurns([])} disabled={loading} title="Clear conversation">
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          )}
        </Stack>

        {/* Starter prompts — only when empty */}
        {turns.length === 0 && (
          <Stack direction="row" gap={0.75} flexWrap="wrap" sx={{ mt: 1, ml: 4 }}>
            {SUGGESTIONS.map((s) => (
              <Chip
                key={s}
                label={s}
                size="small"
                variant="outlined"
                onClick={() => submit(s)}
                sx={{
                  cursor: "pointer",
                  fontSize: "0.7rem",
                  "&:hover": { bgcolor: (t) => alpha(t.palette.primary.main, 0.08) },
                }}
              />
            ))}
          </Stack>
        )}
      </Box>
    </Paper>
  );
}

function TurnView({ turn }: { turn: Turn }) {
  return (
    <Box>
      {/* User question */}
      <Stack direction="row" gap={1} alignItems="flex-start" sx={{ mb: 1 }}>
        <Box
          sx={{
            width: 24,
            height: 24,
            borderRadius: "50%",
            bgcolor: (t) => alpha(t.palette.text.primary, 0.08),
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "0.7rem",
            fontWeight: 700,
            flexShrink: 0,
            mt: 0.25,
          }}
        >
          You
        </Box>
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          {turn.question}
        </Typography>
      </Stack>

      {/* Assistant answer */}
      <Stack direction="row" gap={1} alignItems="flex-start">
        <Box
          sx={{
            width: 24,
            height: 24,
            borderRadius: "50%",
            bgcolor: (t) => alpha(t.palette.primary.main, 0.12),
            color: "primary.main",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            mt: 0.25,
          }}
        >
          <AutoAwesomeIcon sx={{ fontSize: "0.875rem" }} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", mb: turn.attachments.length ? 1.5 : 0 }}>
            {renderInlineMarkdown(turn.answer)}
          </Typography>

          {/* Attachments */}
          {turn.attachments.length > 0 && (
            <Stack gap={1.25}>
              {turn.attachments.map((att, i) => (
                <AttachmentView key={i} att={att} />
              ))}
            </Stack>
          )}

        </Box>
      </Stack>
    </Box>
  );
}

function AttachmentView({ att }: { att: Attachment }) {
  if (att.type === "kpi") {
    return (
      <Paper
        variant="outlined"
        sx={{
          p: 1.5,
          borderRadius: 1.5,
          display: "inline-block",
          minWidth: 180,
          borderLeft: 3,
          borderLeftColor: "primary.main",
        }}
      >
        <Typography variant="caption" sx={{ color: "text.secondary", textTransform: "uppercase", fontSize: "0.65rem", fontWeight: 600 }}>
          {att.label}
        </Typography>
        <Typography sx={{ fontFamily: "monospace", fontWeight: 700, fontSize: "1.25rem", lineHeight: 1.1, mt: 0.25 }}>
          {att.value}
        </Typography>
        {att.sub && (
          <Typography variant="caption" sx={{ color: "text.secondary", fontSize: "0.7rem", display: "block", mt: 0.25 }}>
            {att.sub}
          </Typography>
        )}
      </Paper>
    );
  }

  if (att.type === "table") {
    return (
      <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 1.5 }}>
        {att.title && (
          <Typography variant="caption" sx={{ display: "block", px: 2, py: 1, fontWeight: 700, color: "text.secondary" }}>
            {att.title}
          </Typography>
        )}
        <Table size="small">
          <TableHead>
            <TableRow>
              {att.columns.map((c) => (
                <TableCell key={c} sx={{ fontWeight: 700, fontSize: "0.75rem" }}>
                  {c}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {att.rows.map((row, i) => (
              <TableRow key={i}>
                {row.map((cell, j) => (
                  <TableCell key={j} sx={{ fontSize: "0.8125rem", fontFamily: typeof cell === "number" ? "monospace" : undefined }}>
                    {typeof cell === "number"
                      ? cell.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                      : cell}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    );
  }

  if (att.type === "link") {
    return (
      <Button
        component={Link}
        href={att.href}
        size="small"
        variant="outlined"
        endIcon={<OpenInNewIcon sx={{ fontSize: "0.875rem !important" }} />}
        sx={{ alignSelf: "flex-start", textTransform: "none" }}
      >
        {att.label}
      </Button>
    );
  }

  return null;
}

// Tiny inline-markdown renderer: handles **bold**, *italic*, `code`, and bare
// URLs. Keeps the answer text Typography-clean without pulling in react-markdown.
function renderInlineMarkdown(text: string): React.ReactNode {
  if (!text) return null;

  // Tokenize in priority order — bold first (so the **...** doesn't get
  // mis-parsed as italic), then italic, then inline code, then URLs.
  // We process each line independently so newlines from pre-wrap still work.
  const pattern = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`|https?:\/\/[^\s)]+)/g;

  return text.split("\n").map((line, lineIdx) => {
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
            sx={{
              fontFamily: "monospace",
              fontSize: "0.85em",
              px: 0.5,
              py: 0.125,
              borderRadius: 0.5,
              bgcolor: (t) => alpha(t.palette.text.primary, 0.06),
            }}
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
        {lineIdx < text.split("\n").length - 1 ? "\n" : null}
      </span>
    );
  });
}
