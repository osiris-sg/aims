"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
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
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import RefreshIcon from "@mui/icons-material/Refresh";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditIcon from "@mui/icons-material/Edit";
import { toast } from "react-toastify";
import { useAccountingApi } from "../_lib/api";
import RecurringTemplateDialog from "./_components/RecurringTemplateDialog";

type Template = {
  id: string;
  name: string;
  description?: string | null;
  reference?: string | null;
  frequency: "DAILY" | "WEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY";
  nextRunDate: string;
  lastRunAt?: string | null;
  isActive: boolean;
  endDate?: string | null;
  lines: any[];
};

export default function RecurringPage() {
  const { request } = useAccountingApi();
  const [items, setItems] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request<Template[]>("/recurring-journals");
      setItems(res || []);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load recurring journals");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleActive = async (t: Template) => {
    try {
      await request(`/recurring-journals/${t.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !t.isActive }),
      });
      load();
    } catch (e: any) {
      toast.error(e?.message || "Toggle failed");
    }
  };

  const remove = async (t: Template) => {
    if (!confirm(`Delete template "${t.name}"? Past entries it created remain.`)) return;
    try {
      await request(`/recurring-journals/${t.id}`, { method: "DELETE" });
      toast.success("Deleted");
      load();
    } catch (e: any) {
      toast.error(e?.message || "Delete failed");
    }
  };

  const runNow = async (t: Template) => {
    setRunningId(t.id);
    try {
      const res = await request<{ journalNumber: string }>(`/recurring-journals/${t.id}/run`, { method: "POST" });
      toast.success(`Posted draft ${res.journalNumber} — review in Audit Trail`);
      load();
    } catch (e: any) {
      toast.error(e?.message || "Run failed");
    } finally {
      setRunningId(null);
    }
  };

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            Recurring Journals
          </Typography>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            Templates that auto-create DRAFT journal entries on a schedule. Drafts always need review before posting.
          </Typography>
        </Box>
        <Stack direction="row" gap={1}>
          <Button startIcon={<RefreshIcon />} variant="outlined" size="small" onClick={load}>
            Refresh
          </Button>
          <Button
            startIcon={<AddIcon />}
            variant="contained"
            size="small"
            onClick={() => {
              setEditing(null);
              setEditorOpen(true);
            }}
          >
            New Template
          </Button>
        </Stack>
      </Stack>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 700, width: 80 }}>Active</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Frequency</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Next run</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Last run</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700 }}>Lines</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700 }}>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 4 }}>
                  <CircularProgress size={20} />
                </TableCell>
              </TableRow>
            )}
            {!loading && items.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 4, color: "text.secondary" }}>
                  No recurring templates yet. Click "New Template" to create one.
                </TableCell>
              </TableRow>
            )}
            {items.map((t) => {
              const isDue = new Date(t.nextRunDate) <= new Date() && t.isActive;
              return (
                <TableRow key={t.id} hover>
                  <TableCell>
                    <Switch size="small" checked={t.isActive} onChange={() => toggleActive(t)} />
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" gap={1} alignItems="center">
                      <Box>
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>{t.name}</Typography>
                        {t.description && (
                          <Typography variant="caption" sx={{ color: "text.secondary" }}>{t.description}</Typography>
                        )}
                      </Box>
                      {isDue && <Chip size="small" label="Due" color="warning" variant="outlined" sx={{ fontSize: "0.65rem", height: 18 }} />}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Chip size="small" variant="outlined" label={t.frequency} sx={{ fontSize: "0.7rem" }} />
                  </TableCell>
                  <TableCell sx={{ fontFamily: "monospace", fontSize: "0.8125rem" }}>
                    {new Date(t.nextRunDate).toLocaleDateString()}
                  </TableCell>
                  <TableCell sx={{ fontFamily: "monospace", fontSize: "0.8125rem", color: "text.secondary" }}>
                    {t.lastRunAt ? new Date(t.lastRunAt).toLocaleDateString() : "—"}
                  </TableCell>
                  <TableCell align="right">{Array.isArray(t.lines) ? t.lines.length : 0}</TableCell>
                  <TableCell align="right">
                    <Tooltip title="Run now">
                      <span>
                        <IconButton
                          size="small"
                          onClick={() => runNow(t)}
                          disabled={runningId === t.id}
                        >
                          {runningId === t.id ? (
                            <CircularProgress size={14} />
                          ) : (
                            <PlayArrowIcon fontSize="small" />
                          )}
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title="Edit">
                      <IconButton size="small" onClick={() => { setEditing(t); setEditorOpen(true); }}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete">
                      <IconButton size="small" onClick={() => remove(t)}>
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      <RecurringTemplateDialog
        open={editorOpen}
        editing={editing}
        onClose={() => setEditorOpen(false)}
        onSaved={() => {
          setEditorOpen(false);
          load();
        }}
      />
    </Box>
  );
}
