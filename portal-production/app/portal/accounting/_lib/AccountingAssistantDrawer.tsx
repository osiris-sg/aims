"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Drawer,
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
import CloseIcon from "@mui/icons-material/Close";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import Link from "next/link";
import { toast } from "react-toastify";
import { useAuth } from "@clerk/nextjs";

type Attachment =
  | { type: "kpi"; label: string; value: string; sub?: string }
  | { type: "table"; title?: string; columns: string[]; rows: Array<Array<string | number>> }
  | { type: "link"; href: string; label: string };

type Turn = { role: "user" | "assistant"; content: string; attachments?: Attachment[] };

const SUGGESTIONS = [
  "Who owes me the most money?",
  "Show me overdue invoices",
  "What's my net profit this month?",
  "How much is my total AR and AP?",
  "GST payable this quarter",
];

// Narrate what the agent is doing while each tool runs.
function statusForTool(tool: string): string {
  switch (tool) {
    case "get_finance_hub": return "Reading your finance hub…";
    case "get_trial_balance": return "Fetching the trial balance…";
    case "get_profit_loss": return "Calculating profit & loss…";
    case "get_balance_sheet": return "Building the balance sheet…";
    case "get_gst_report": return "Preparing the GST report…";
    case "list_journal_entries": return "Looking up journal entries…";
    case "list_accounts": return "Loading the chart of accounts…";
    case "get_account_ledger": return "Reading the account ledger…";
    case "get_aged_receivables": return "Reading your receivables…";
    case "get_aged_payables": return "Reading your payables…";
    case "list_invoices": return "Searching invoices…";
    case "get_customer_statement": return "Pulling the customer statement…";
    default: return "Working…";
  }
}

export default function AccountingAssistantDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { getToken } = useAuth();
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [streaming, setStreaming] = useState<Turn | null>(null);
  const [statusLabel, setStatusLabel] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length, streaming?.content, statusLabel]);

  const submit = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      if (!trimmed || loading) return;
      setLoading(true);
      const history = turns.map((t) => ({ role: t.role, content: t.content }));
      setTurns((prev) => [...prev, { role: "user", content: trimmed }]);
      setInput("");
      const acc: Turn = { role: "assistant", content: "", attachments: [] };
      setStreaming({ ...acc });
      setStatusLabel("Thinking…");

      try {
        const token = await getToken();
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;
        if (typeof window !== "undefined") {
          const activeOrgId = window.sessionStorage.getItem("aims-admin-active-org");
          if (activeOrgId) headers["X-Active-Org-Id"] = activeOrgId;
        }
        const resp = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}/ask/stream`, {
          method: "POST",
          headers,
          body: JSON.stringify({ question: trimmed, history }),
        });
        if (!resp.ok || !resp.body) throw new Error(`Assistant failed (${resp.status})`);

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() || "";
          for (const frame of frames) {
            const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
            if (!dataLine) continue;
            let evt: any;
            try { evt = JSON.parse(dataLine.slice(5).trim()); } catch { continue; }
            if (evt.type === "text") {
              acc.content += evt.delta;
              setStatusLabel(null);
              setStreaming({ ...acc });
            } else if (evt.type === "status") {
              setStatusLabel(statusForTool(evt.tool));
            } else if (evt.type === "attachment") {
              acc.attachments = [...(acc.attachments || []), evt.attachment];
              setStreaming({ ...acc });
            } else if (evt.type === "error") {
              throw new Error(evt.message || "Assistant failed");
            }
          }
        }
        setTurns((prev) => [...prev, { role: "assistant", content: acc.content || "No response.", attachments: acc.attachments }]);
      } catch (e: any) {
        toast.error(e?.message || "Assistant failed");
        setTurns((prev) => [...prev, { role: "assistant", content: acc.content || "Sorry — something went wrong. Please try again.", attachments: acc.attachments }]);
      } finally {
        setStreaming(null);
        setStatusLabel(null);
        setLoading(false);
      }
    },
    [loading, turns, getToken],
  );

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      hideBackdrop
      ModalProps={{ keepMounted: true, disableEnforceFocus: true, disableScrollLock: true }}
      sx={{
        pointerEvents: "none",
        "& .MuiDrawer-paper": {
          pointerEvents: "auto",
          width: { xs: "100%", sm: 460 },
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
      <Box sx={{ px: 2, py: 1.5, display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: 1, borderColor: "divider" }}>
        <Stack direction="row" alignItems="center" gap={1}>
          <AutoAwesomeIcon sx={{ color: "primary.main", fontSize: "1.25rem" }} />
          <Typography sx={{ fontWeight: 700 }}>Accounting Assistant</Typography>
        </Stack>
        <Stack direction="row" gap={0.5}>
          {turns.length > 0 && (
            <IconButton size="small" onClick={() => setTurns([])} disabled={loading} title="Clear conversation">
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          )}
          <IconButton size="small" onClick={onClose} title="Close">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>
      </Box>

      {/* Conversation */}
      <Box sx={{ flex: 1, overflowY: "auto", p: 2 }}>
        {turns.length === 0 && !streaming && (
          <Stack alignItems="center" gap={1.5} sx={{ mt: 6, px: 3, textAlign: "center" }}>
            <AutoAwesomeIcon sx={{ color: "primary.main", fontSize: "2rem" }} />
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              Ask me anything about your accounts — receivables, payables, invoices, P&amp;L, GST, balances.
            </Typography>
          </Stack>
        )}
        <Stack gap={2}>
          {turns.map((t, i) => (t.role === "user" ? <UserMsg key={i} text={t.content} /> : <AssistantMsg key={i} turn={t} />))}
          {streaming && <AssistantMsg turn={streaming} statusLabel={statusLabel} />}
          {!streaming && statusLabel && <ThinkingRow label={statusLabel} />}
          <div ref={scrollRef} />
        </Stack>
      </Box>

      {/* Input */}
      <Box sx={{ p: 1.5, borderTop: 1, borderColor: "divider" }}>
        {turns.length === 0 && (
          <Stack direction="row" gap={0.75} flexWrap="wrap" sx={{ mb: 1 }}>
            {SUGGESTIONS.map((s) => (
              <Chip key={s} label={s} size="small" variant="outlined" onClick={() => submit(s)} sx={{ cursor: "pointer", fontSize: "0.7rem", "&:hover": { bgcolor: (t) => alpha(t.palette.primary.main, 0.08) } }} />
            ))}
          </Stack>
        )}
        <Stack direction="row" alignItems="center" gap={1}>
          <TextField
            fullWidth
            size="small"
            multiline
            maxRows={4}
            placeholder="Ask about your accounts…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(input); } }}
            disabled={loading}
            InputProps={{ sx: { fontSize: "0.9375rem" } }}
          />
          <Button variant="contained" onClick={() => submit(input)} disabled={loading || !input.trim()} sx={{ minWidth: 44, px: 1.5 }}>
            {loading ? <CircularProgress size={16} color="inherit" /> : <SendIcon fontSize="small" />}
          </Button>
        </Stack>
      </Box>
    </Drawer>
  );
}

function UserMsg({ text }: { text: string }) {
  return (
    <Stack direction="row" gap={1} alignItems="flex-start">
      <Box sx={{ width: 26, height: 26, borderRadius: "50%", bgcolor: (t) => alpha(t.palette.text.primary, 0.08), display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.7rem", fontWeight: 700, flexShrink: 0, mt: 0.25 }}>You</Box>
      <Typography variant="body2" sx={{ fontWeight: 500, whiteSpace: "pre-wrap" }}>{text}</Typography>
    </Stack>
  );
}

function AssistantMsg({ turn, statusLabel }: { turn: Turn; statusLabel?: string | null }) {
  return (
    <Stack direction="row" gap={1} alignItems="flex-start">
      <Box sx={{ width: 26, height: 26, borderRadius: "50%", bgcolor: (t) => alpha(t.palette.primary.main, 0.12), color: "primary.main", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, mt: 0.25 }}>
        <AutoAwesomeIcon sx={{ fontSize: "0.9rem" }} />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {statusLabel && !turn.content && <ThinkingLabel label={statusLabel} />}
        {turn.content && (
          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", mb: turn.attachments?.length ? 1.5 : 0 }}>
            {renderInlineMarkdown(turn.content)}
          </Typography>
        )}
        {!!turn.attachments?.length && (
          <Stack gap={1.25}>
            {turn.attachments.map((att, i) => <AttachmentView key={i} att={att} />)}
          </Stack>
        )}
      </Box>
    </Stack>
  );
}

function ThinkingRow({ label }: { label: string }) {
  return (
    <Stack direction="row" gap={1} alignItems="center" sx={{ pl: 4.5 }}>
      <CircularProgress size={12} />
      <Typography variant="caption" sx={{ color: "text.secondary", fontStyle: "italic" }}>{label}</Typography>
    </Stack>
  );
}

function ThinkingLabel({ label }: { label: string }) {
  return (
    <Stack direction="row" gap={1} alignItems="center">
      <CircularProgress size={12} />
      <Typography variant="caption" sx={{ color: "text.secondary", fontStyle: "italic" }}>{label}</Typography>
    </Stack>
  );
}

function AttachmentView({ att }: { att: Attachment }) {
  if (att.type === "kpi") {
    return (
      <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5, display: "inline-block", minWidth: 180, borderLeft: 3, borderLeftColor: "primary.main" }}>
        <Typography variant="caption" sx={{ color: "text.secondary", textTransform: "uppercase", fontSize: "0.65rem", fontWeight: 600 }}>{att.label}</Typography>
        <Typography sx={{ fontFamily: "monospace", fontWeight: 700, fontSize: "1.25rem", lineHeight: 1.1, mt: 0.25 }}>{att.value}</Typography>
        {att.sub && <Typography variant="caption" sx={{ color: "text.secondary", fontSize: "0.7rem", display: "block", mt: 0.25 }}>{att.sub}</Typography>}
      </Paper>
    );
  }
  if (att.type === "table") {
    return (
      <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 1.5 }}>
        {att.title && <Typography variant="caption" sx={{ display: "block", px: 2, py: 1, fontWeight: 700, color: "text.secondary" }}>{att.title}</Typography>}
        <Table size="small">
          <TableHead>
            <TableRow>{att.columns.map((c) => <TableCell key={c} sx={{ fontWeight: 700, fontSize: "0.75rem" }}>{c}</TableCell>)}</TableRow>
          </TableHead>
          <TableBody>
            {att.rows.map((row, i) => (
              <TableRow key={i}>
                {row.map((cell, j) => (
                  <TableCell key={j} sx={{ fontSize: "0.8125rem", fontFamily: typeof cell === "number" ? "monospace" : undefined }}>
                    {typeof cell === "number" ? cell.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : cell}
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
      <Button component={Link} href={att.href} size="small" variant="outlined" endIcon={<OpenInNewIcon sx={{ fontSize: "0.875rem !important" }} />} sx={{ alignSelf: "flex-start", textTransform: "none" }}>
        {att.label}
      </Button>
    );
  }
  return null;
}

function renderInlineMarkdown(text: string): React.ReactNode {
  if (!text) return null;
  const pattern = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`|https?:\/\/[^\s)]+)/g;
  return text.split("\n").map((line, lineIdx) => {
    const parts: React.ReactNode[] = [];
    let lastIdx = 0;
    let m: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((m = pattern.exec(line)) !== null) {
      if (m.index > lastIdx) parts.push(line.slice(lastIdx, m.index));
      const token = m[0];
      if (token.startsWith("**") && token.endsWith("**")) parts.push(<Box component="strong" key={`b${m.index}`} sx={{ fontWeight: 700 }}>{token.slice(2, -2)}</Box>);
      else if (token.startsWith("*") && token.endsWith("*")) parts.push(<Box component="em" key={`i${m.index}`} sx={{ fontStyle: "italic" }}>{token.slice(1, -1)}</Box>);
      else if (token.startsWith("`") && token.endsWith("`")) parts.push(<Box component="code" key={`c${m.index}`} sx={{ fontFamily: "monospace", fontSize: "0.85em", px: 0.5, py: 0.125, borderRadius: 0.5, bgcolor: (t) => alpha(t.palette.text.primary, 0.06) }}>{token.slice(1, -1)}</Box>);
      else if (/^https?:\/\//.test(token)) parts.push(<a key={`u${m.index}`} href={token} target="_blank" rel="noopener noreferrer">{token}</a>);
      else parts.push(token);
      lastIdx = m.index + token.length;
    }
    if (lastIdx < line.length) parts.push(line.slice(lastIdx));
    return <span key={lineIdx}>{parts}{lineIdx < text.split("\n").length - 1 ? "\n" : null}</span>;
  });
}
