"use client";

// AI Agent tab — per-org agent settings, Q&A training pairs, and a dry-run
// tester that drafts a reply without sending anything.

import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  IconButton,
  Paper,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { Add, Delete, Psychology, Save } from "@mui/icons-material";
import { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import { useWhatsAppApi } from "../_lib/api";

interface AgentConfig {
  enabled: boolean;
  autoSendEnabled: boolean;
  autoSendGuidance: string | null;
  aiGuidance: string | null;
}

interface QnARow {
  id: string;
  question: string;
  answer: string;
  createdAt: string;
}

interface Verdict {
  reply: string;
  canAutoSend: boolean;
  confidence: number;
  reason: string;
  usedHistoryMessages?: number;
  usedCustomerRecord?: boolean;
}

export default function AgentTab() {
  const { request } = useWhatsAppApi();

  const [config, setConfig] = useState<AgentConfig>({
    enabled: false,
    autoSendEnabled: false,
    autoSendGuidance: "",
    aiGuidance: "",
  });
  const [qna, setQna] = useState<QnARow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [newQuestion, setNewQuestion] = useState("");
  const [newAnswer, setNewAnswer] = useState("");
  const [adding, setAdding] = useState(false);

  const [testMessage, setTestMessage] = useState("");
  const [testCounterparty, setTestCounterparty] = useState("");
  const [testing, setTesting] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);

  const load = useCallback(async () => {
    try {
      const [cfg, pairs] = await Promise.all([
        request<AgentConfig>("/whatsapp/agent/config"),
        request<QnARow[]>("/whatsapp/agent/qna"),
      ]);
      setConfig({
        enabled: !!cfg.enabled,
        autoSendEnabled: !!cfg.autoSendEnabled,
        autoSendGuidance: cfg.autoSendGuidance || "",
        aiGuidance: cfg.aiGuidance || "",
      });
      setQna(Array.isArray(pairs) ? pairs : []);
    } catch (e: any) {
      toast.error(e.message || "Failed to load agent settings");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    load();
  }, [load]);

  const saveConfig = useCallback(async () => {
    setSaving(true);
    try {
      await request("/whatsapp/agent/config", { method: "PUT", body: JSON.stringify(config) });
      toast.success("Agent settings saved");
    } catch (e: any) {
      toast.error(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }, [request, config]);

  const addPair = useCallback(async () => {
    if (!newQuestion.trim() || !newAnswer.trim()) {
      toast.error("Enter both a sample message and its response");
      return;
    }
    setAdding(true);
    try {
      const row = await request<QnARow>("/whatsapp/agent/qna", {
        method: "POST",
        body: JSON.stringify({ question: newQuestion, answer: newAnswer }),
      });
      setQna((prev) => [row, ...prev]);
      setNewQuestion("");
      setNewAnswer("");
      toast.success("Training pair added");
    } catch (e: any) {
      toast.error(e.message || "Add failed");
    } finally {
      setAdding(false);
    }
  }, [request, newQuestion, newAnswer]);

  const deletePair = useCallback(
    async (id: string) => {
      try {
        await request(`/whatsapp/agent/qna/${id}`, { method: "DELETE" });
        setQna((prev) => prev.filter((p) => p.id !== id));
      } catch (e: any) {
        toast.error(e.message || "Delete failed");
      }
    },
    [request],
  );

  const runTest = useCallback(async () => {
    if (!testMessage.trim()) return;
    setTesting(true);
    setVerdict(null);
    try {
      const v = await request<Verdict>("/whatsapp/agent/dry-run", {
        method: "POST",
        body: JSON.stringify({ message: testMessage, counterparty: testCounterparty || undefined }),
      });
      setVerdict(v);
    } catch (e: any) {
      toast.error(e.message || "Test failed");
    } finally {
      setTesting(false);
    }
  }, [request, testMessage, testCounterparty]);

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Stack spacing={3}>
      {/* Settings */}
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
          <Psychology color="primary" />
          <Typography variant="h6">Agent settings</Typography>
        </Stack>
        <Stack spacing={2}>
          <FormControlLabel
            control={
              <Switch
                checked={config.enabled}
                onChange={(e) => setConfig((c) => ({ ...c, enabled: e.target.checked }))}
              />
            }
            label="Enable AI agent — draft a reply for every incoming message"
          />
          <FormControlLabel
            control={
              <Switch
                checked={config.autoSendEnabled}
                onChange={(e) => setConfig((c) => ({ ...c, autoSendEnabled: e.target.checked }))}
                disabled={!config.enabled}
              />
            }
            label="Allow auto-send — the AI replies on its own for the message kinds below; everything else waits for review"
          />
          <TextField
            label="Message kinds the AI may answer on its own"
            placeholder="e.g. opening hours, price list questions, delivery status, service booking requests"
            value={config.autoSendGuidance || ""}
            onChange={(e) => setConfig((c) => ({ ...c, autoSendGuidance: e.target.value }))}
            multiline
            minRows={2}
            disabled={!config.enabled}
            helperText="Anything outside these kinds is never auto-sent — it goes to the Suggestions queue instead."
          />
          <TextField
            label="General instructions (tone, language, business facts)"
            placeholder="e.g. Reply in a friendly tone. We are an aircon servicing company. Office hours 9am–6pm Mon–Sat."
            value={config.aiGuidance || ""}
            onChange={(e) => setConfig((c) => ({ ...c, aiGuidance: e.target.value }))}
            multiline
            minRows={2}
            disabled={!config.enabled}
          />
          <Box>
            <Button variant="contained" startIcon={<Save />} disabled={saving} onClick={saveConfig}>
              Save settings
            </Button>
          </Box>
        </Stack>
      </Paper>

      {/* Training pairs */}
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Typography variant="h6" sx={{ mb: 0.5 }}>
          Training examples
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Sample customer messages and the reply the AI should learn from. The closest examples are shown to the AI for
          every incoming message.
        </Typography>
        <Stack spacing={1.5} sx={{ mb: 2 }}>
          <TextField
            label="Sample customer message"
            value={newQuestion}
            onChange={(e) => setNewQuestion(e.target.value)}
            size="small"
            multiline
          />
          <TextField
            label="Ideal response"
            value={newAnswer}
            onChange={(e) => setNewAnswer(e.target.value)}
            size="small"
            multiline
          />
          <Box>
            <Button variant="outlined" startIcon={<Add />} disabled={adding} onClick={addPair}>
              Add pair
            </Button>
          </Box>
        </Stack>
        {qna.length === 0 ? (
          <Alert severity="info">No training pairs yet — the AI will refuse to auto-send until it has examples.</Alert>
        ) : (
          <TableContainer sx={{ overflowX: "auto" }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Customer message</TableCell>
                  <TableCell>Response</TableCell>
                  <TableCell width={48} />
                </TableRow>
              </TableHead>
              <TableBody>
                {qna.map((row) => (
                  <TableRow key={row.id} hover>
                    <TableCell sx={{ whiteSpace: "pre-wrap", maxWidth: 320 }}>{row.question}</TableCell>
                    <TableCell sx={{ whiteSpace: "pre-wrap", maxWidth: 420 }}>{row.answer}</TableCell>
                    <TableCell>
                      <IconButton size="small" onClick={() => deletePair(row.id)} aria-label="Delete pair">
                        <Delete fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>

      {/* Dry-run tester */}
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Typography variant="h6" sx={{ mb: 0.5 }}>
          Test the agent
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Type a message as if a customer sent it — nothing is sent to anyone.
        </Typography>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ sm: "flex-start" }}>
          <TextField
            label="Customer message"
            value={testMessage}
            onChange={(e) => setTestMessage(e.target.value)}
            fullWidth
            multiline
            size="small"
          />
          <TextField
            label="Customer number (optional)"
            placeholder="6591234567"
            value={testCounterparty}
            onChange={(e) => setTestCounterparty(e.target.value)}
            size="small"
            sx={{ minWidth: 210 }}
            helperText="Loads that chat's history + customer record"
          />
          <Button variant="contained" disabled={testing || !testMessage.trim()} onClick={runTest}>
            {testing ? <CircularProgress size={20} color="inherit" /> : "Run"}
          </Button>
        </Stack>
        {verdict && (
          <Box sx={{ mt: 2 }}>
            <Divider sx={{ mb: 2 }} />
            <Stack spacing={1}>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                <Chip
                  size="small"
                  label={verdict.canAutoSend ? "Would auto-send" : "Would ask for review"}
                  color={verdict.canAutoSend ? "success" : "warning"}
                />
                <Chip size="small" variant="outlined" label={`confidence ${(verdict.confidence * 100).toFixed(0)}%`} />
                {typeof verdict.usedHistoryMessages === "number" && verdict.usedHistoryMessages > 0 && (
                  <Chip size="small" variant="outlined" label={`${verdict.usedHistoryMessages} past messages`} />
                )}
                {verdict.usedCustomerRecord && (
                  <Chip size="small" variant="outlined" color="info" label="customer record used" />
                )}
                <Typography variant="caption" color="text.secondary">
                  {verdict.reason}
                </Typography>
              </Stack>
              <Paper variant="outlined" sx={{ p: 2, whiteSpace: "pre-wrap" }}>
                <Typography variant="body2">{verdict.reply}</Typography>
              </Paper>
            </Stack>
          </Box>
        )}
      </Paper>
    </Stack>
  );
}
