"use client";
import React, { useCallback, useEffect, useState } from "react";
import {
  Drawer,
  Box,
  Typography,
  IconButton,
  TextField,
  Button,
  Chip,
  Divider,
  CircularProgress,
} from "@mui/material";
import { Close as CloseIcon, History as HistoryIcon } from "@mui/icons-material";
import { useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";

interface HistoryEntry {
  id: string;
  action: string;
  userName?: string | null;
  userEmail?: string | null;
  details?: { detail?: string; changes?: string[] } | null;
  createdAt: string;
}

// Pastel chip fills with dark text — legible on both light and dark themes
// (the theme palette maps success/info to monochrome, so no `color=` here).
const ACTION_CHIPS: Record<string, { label: string; sx: object }> = {
  CREATED: { label: "Created", sx: { bgcolor: "#E3F0FB", color: "#0B5394" } },
  EDITED: { label: "Edited", sx: { bgcolor: "#EEF0F2", color: "#40484F" } },
  APPROVED: { label: "Approved", sx: { bgcolor: "#DCF5E4", color: "#116632" } },
  STATUS_CHANGED: { label: "Status changed", sx: { bgcolor: "#FBEEDC", color: "#8A5A00" } },
  NOTE: { label: "Note", sx: { bgcolor: "#F0E8FB", color: "#5B2E98" } },
  SENT: { label: "Sent", sx: { bgcolor: "#DCF0F5", color: "#0A5A6E" } },
  DELETED: { label: "Deleted", sx: { bgcolor: "#FBE3E3", color: "#8B1A1A" } },
};

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

interface DocumentHistoryDrawerProps {
  open: boolean;
  onClose: () => void;
  documentId: string;
}

export default function DocumentHistoryDrawer({ open, onClose, documentId }: DocumentHistoryDrawerProps) {
  const { getToken } = useAuth();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    if (!documentId) return;
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const res: any = await request({ path: `/documents/${documentId}/history`, method: "GET" }, {}, token || undefined);
      const rows = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : [];
      setEntries(rows);
    } catch {
      setError("Failed to load history");
    } finally {
      setLoading(false);
    }
  }, [documentId, getToken]);

  useEffect(() => {
    if (open) fetchHistory();
  }, [open, fetchHistory]);

  const handleAddNote = async () => {
    const text = noteText.trim();
    if (!text || !documentId) return;
    setSavingNote(true);
    try {
      const token = await getToken();
      await request({ path: `/documents/${documentId}/notes`, method: "POST" }, { text }, token || undefined);
      setNoteText("");
      await fetchHistory();
    } catch {
      setError("Failed to add note");
    } finally {
      setSavingNote(false);
    }
  };

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      slotProps={{ paper: { sx: { width: { xs: "100%", sm: 560 }, display: "flex", flexDirection: "column" } } }}
    >
      {/* Header */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 2, py: 1.5, borderBottom: 1, borderColor: "divider" }}>
        <HistoryIcon fontSize="small" />
        <Typography variant="subtitle1" sx={{ fontWeight: 700, flex: 1 }}>
          History &amp; notes
        </Typography>
        <IconButton size="small" onClick={onClose}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>

      {/* Add note */}
      <Box sx={{ display: "flex", gap: 1, px: 2, py: 1.5, borderBottom: 1, borderColor: "divider" }}>
        <TextField
          size="small"
          fullWidth
          multiline
          maxRows={4}
          placeholder="Add a note…"
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          disabled={savingNote}
        />
        <Button
          size="small"
          variant="contained"
          onClick={handleAddNote}
          disabled={savingNote || !noteText.trim()}
          sx={{ alignSelf: "flex-end", whiteSpace: "nowrap" }}
        >
          {savingNote ? "Adding…" : "Add note"}
        </Button>
      </Box>

      {/* Entries */}
      <Box sx={{ flex: 1, overflowY: "auto", px: 2, py: 1 }}>
        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
            <CircularProgress size={22} />
          </Box>
        ) : error ? (
          <Typography variant="body2" color="error" sx={{ py: 2 }}>
            {error}
          </Typography>
        ) : entries.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
            No history yet — edits, status changes and notes will show up here.
          </Typography>
        ) : (
          entries.map((entry, i) => {
            const chip = ACTION_CHIPS[entry.action] || { label: entry.action, sx: {} };
            const lines =
              entry.details?.changes && entry.details.changes.length > 0
                ? entry.details.changes
                : entry.details?.detail
                ? [entry.details.detail]
                : [];
            return (
              <Box key={entry.id}>
                {i > 0 && <Divider sx={{ my: 0.5 }} />}
                <Box sx={{ py: 1 }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
                    <Chip size="small" label={chip.label} sx={{ fontWeight: 600, ...chip.sx }} />
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {entry.userName || entry.userEmail || "System"}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ ml: "auto", whiteSpace: "nowrap" }}>
                      {formatWhen(entry.createdAt)}
                    </Typography>
                  </Box>
                  {lines.map((line, j) => (
                    <Typography key={j} variant="body2" color="text.secondary" sx={{ pl: 0.25 }}>
                      {line}
                    </Typography>
                  ))}
                </Box>
              </Box>
            );
          })
        )}
      </Box>
    </Drawer>
  );
}
