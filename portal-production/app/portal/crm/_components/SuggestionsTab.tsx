"use client";

// Suggestions tab — the review queue. Pending suggestions can be edited,
// approved (sends via the org's WhatsApp number) or dismissed; the history
// below shows what the agent auto-sent or the team already handled.

import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { Check, Close, Refresh } from "@mui/icons-material";
import { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import { useWhatsAppApi } from "../_lib/api";

interface Suggestion {
  id: string;
  counterparty: string;
  inboundBody: string;
  suggestedReply: string;
  canAutoSend: boolean;
  confidence: number | null;
  reason: string | null;
  status: "PENDING" | "AUTO_SENT" | "SENT" | "DISMISSED" | "HANDLED_MANUALLY";
  createdAt: string;
}

const statusColor = (s: Suggestion["status"]): "warning" | "success" | "info" | "default" => {
  switch (s) {
    case "PENDING":
      return "warning";
    case "AUTO_SENT":
      return "success";
    case "SENT":
      return "info";
    default:
      return "default";
  }
};

export default function SuggestionsTab({ onPendingCount }: { onPendingCount?: (n: number) => void }) {
  const { request } = useWhatsAppApi();

  const [rows, setRows] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await request<Suggestion[]>("/whatsapp/agent/suggestions");
      setRows(Array.isArray(list) ? list : []);
      onPendingCount?.((list || []).filter((r) => r.status === "PENDING").length);
    } catch (e: any) {
      toast.error(e.message || "Failed to load suggestions");
    } finally {
      setLoading(false);
    }
  }, [request, onPendingCount]);

  useEffect(() => {
    load();
  }, [load]);

  const approve = useCallback(
    async (row: Suggestion) => {
      setBusy(row.id);
      try {
        await request(`/whatsapp/agent/suggestions/${row.id}/approve`, {
          method: "POST",
          body: JSON.stringify({ reply: edits[row.id] ?? row.suggestedReply }),
        });
        toast.success("Reply sent");
        await load();
      } catch (e: any) {
        toast.error(e.message || "Send failed");
      } finally {
        setBusy(null);
      }
    },
    [request, edits, load],
  );

  const dismiss = useCallback(
    async (row: Suggestion) => {
      setBusy(row.id);
      try {
        await request(`/whatsapp/agent/suggestions/${row.id}/dismiss`, { method: "POST" });
        await load();
      } catch (e: any) {
        toast.error(e.message || "Dismiss failed");
      } finally {
        setBusy(null);
      }
    },
    [request, load],
  );

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  const pending = rows.filter((r) => r.status === "PENDING");
  const history = rows.filter((r) => r.status !== "PENDING");

  return (
    <Stack spacing={3}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="h6">Needs review ({pending.length})</Typography>
        <Button size="small" startIcon={<Refresh />} onClick={load}>
          Refresh
        </Button>
      </Stack>

      {pending.length === 0 ? (
        <Alert severity="success">Nothing waiting — the agent has no unanswered messages.</Alert>
      ) : (
        pending.map((row) => (
          <Paper key={row.id} variant="outlined" sx={{ p: 2.5 }}>
            <Stack spacing={1.5}>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                <Chip size="small" label={row.counterparty} variant="outlined" />
                <Typography variant="caption" color="text.secondary">
                  {new Date(row.createdAt).toLocaleString()}
                </Typography>
                {typeof row.confidence === "number" && (
                  <Chip size="small" variant="outlined" label={`confidence ${(row.confidence * 100).toFixed(0)}%`} />
                )}
              </Stack>
              <Paper variant="outlined" sx={{ p: 1.5, bgcolor: "action.hover" }}>
                <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                  {row.inboundBody}
                </Typography>
              </Paper>
              {row.reason && (
                <Typography variant="caption" color="text.secondary">
                  Why it wasn&apos;t auto-sent: {row.reason}
                </Typography>
              )}
              <TextField
                label="Suggested reply (editable)"
                value={edits[row.id] ?? row.suggestedReply}
                onChange={(e) => setEdits((prev) => ({ ...prev, [row.id]: e.target.value }))}
                multiline
                minRows={2}
                fullWidth
              />
              <Stack direction="row" spacing={1.5}>
                <Button
                  variant="contained"
                  startIcon={<Check />}
                  disabled={busy === row.id}
                  onClick={() => approve(row)}
                >
                  Approve &amp; send
                </Button>
                <Button
                  variant="outlined"
                  color="inherit"
                  startIcon={<Close />}
                  disabled={busy === row.id}
                  onClick={() => dismiss(row)}
                >
                  Dismiss
                </Button>
              </Stack>
            </Stack>
          </Paper>
        ))
      )}

      {history.length > 0 && (
        <>
          <Typography variant="h6" sx={{ mt: 1 }}>
            History
          </Typography>
          {history.map((row) => (
            <Paper key={row.id} variant="outlined" sx={{ p: 2 }}>
              <Stack spacing={1}>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Chip size="small" label={row.status.replace("_", " ")} color={statusColor(row.status)} />
                  <Chip size="small" label={row.counterparty} variant="outlined" />
                  <Typography variant="caption" color="text.secondary">
                    {new Date(row.createdAt).toLocaleString()}
                  </Typography>
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "pre-wrap" }}>
                  Customer: {row.inboundBody}
                </Typography>
                <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                  Reply: {row.suggestedReply}
                </Typography>
              </Stack>
            </Paper>
          ))}
        </>
      )}
    </Stack>
  );
}
