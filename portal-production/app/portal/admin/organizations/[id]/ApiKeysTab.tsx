"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  Add as AddIcon,
  Block as BlockIcon,
  ContentCopy as ContentCopyIcon,
  Refresh as RefreshIcon,
} from "@mui/icons-material";
import { useAuth } from "@clerk/nextjs";
import { toast } from "react-toastify";
import { request } from "@/helpers/request";

// ─────────────────────────────────────────────────────────────────────────────
// API Keys tab (admin org detail page).
//
// Manages the org's external /v1 API keys (ApiKey table). Minting shows the
// plaintext ONCE — after the dialog closes only the prefix remains visible.
// The autoPost switch decides whether documents created with the key post to
// the GL immediately or land in the accountant Posting Queue (default).
// Backend: src/api-v1/api-keys.admin.controller.ts.
// ─────────────────────────────────────────────────────────────────────────────

interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  autoPost: boolean;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

export default function ApiKeysTab({ organizationId }: { organizationId: string }) {
  const { getToken } = useAuth();
  const [rows, setRows] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newAutoPost, setNewAutoPost] = useState(false);
  // Show-once plaintext after minting
  const [mintedKey, setMintedKey] = useState<string | null>(null);

  const base = `/admin/organizations/${organizationId}/api-keys`;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) return;
      const res: any = await request({ path: base, method: "GET" }, {}, token);
      setRows(res?.data ?? res ?? []);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load API keys");
    } finally {
      setLoading(false);
    }
  }, [getToken, base]);

  useEffect(() => {
    load();
  }, [load]);

  const mint = async () => {
    if (!newName.trim()) return toast.error("Give the key a name (e.g. the app that will use it)");
    setBusy(true);
    try {
      const token = await getToken();
      if (!token) return;
      const res: any = await request(
        { path: base, method: "POST" },
        { name: newName.trim(), autoPost: newAutoPost },
        token,
      );
      const data = res?.data ?? res;
      setMintedKey(data?.key || null);
      setNewName("");
      setNewAutoPost(false);
      load();
    } catch (e: any) {
      toast.error(e?.message || "Failed to create API key");
    } finally {
      setBusy(false);
    }
  };

  const toggleAutoPost = async (row: ApiKeyRow) => {
    try {
      const token = await getToken();
      if (!token) return;
      await request({ path: `${base}/${row.id}`, method: "PATCH" }, { autoPost: !row.autoPost }, token);
      setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, autoPost: !r.autoPost } : r)));
      toast.success(!row.autoPost ? "Documents from this key now auto-post to the GL" : "Documents from this key now queue for review");
    } catch (e: any) {
      toast.error(e?.message || "Failed to update key");
    }
  };

  const revoke = async (row: ApiKeyRow) => {
    if (!window.confirm(`Revoke "${row.name}" (${row.prefix}…)? Apps using it stop working immediately.`)) return;
    try {
      const token = await getToken();
      if (!token) return;
      await request({ path: `${base}/${row.id}/revoke`, method: "POST" }, {}, token);
      toast.success("Key revoked");
      load();
    } catch (e: any) {
      toast.error(e?.message || "Failed to revoke key");
    }
  };

  const copyMinted = () => {
    if (mintedKey) {
      navigator.clipboard.writeText(mintedKey).then(() => toast.success("Key copied"));
    }
  };

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h6">External API Keys</Typography>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            Keys let outside apps call <code>POST /v1/documents</code> (invoices, bills, credit notes) as this
            organization. Documents land in the Posting Queue unless auto-post is on.
          </Typography>
        </Box>
        <Stack direction="row" gap={1}>
          <Button startIcon={<RefreshIcon />} onClick={load} disabled={loading}>
            Refresh
          </Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}>
            Generate Key
          </Button>
        </Stack>
      </Stack>

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", p: 6 }}>
          <CircularProgress />
        </Box>
      ) : rows.length === 0 ? (
        <Alert severity="info">No API keys yet — generate one to let an external app create documents.</Alert>
      ) : (
        <TableContainer sx={{ border: "1px solid var(--table-grid)", borderRadius: 1 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Key</TableCell>
                <TableCell>Scopes</TableCell>
                <TableCell align="center">Auto-post GL</TableCell>
                <TableCell>Last used</TableCell>
                <TableCell>Created</TableCell>
                <TableCell align="center">Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} hover sx={{ opacity: r.revokedAt ? 0.5 : 1 }}>
                  <TableCell>{r.name}</TableCell>
                  <TableCell>
                    <code>{r.prefix}…</code>
                  </TableCell>
                  <TableCell>
                    {r.scopes.map((s) => (
                      <Chip key={s} size="small" label={s} sx={{ mr: 0.5 }} variant="outlined" />
                    ))}
                  </TableCell>
                  <TableCell align="center">
                    <Switch size="small" checked={r.autoPost} disabled={!!r.revokedAt} onChange={() => toggleAutoPost(r)} />
                  </TableCell>
                  <TableCell>{fmtDate(r.lastUsedAt)}</TableCell>
                  <TableCell>{fmtDate(r.createdAt)}</TableCell>
                  <TableCell align="center">
                    {r.revokedAt ? (
                      <Chip size="small" label="Revoked" color="error" variant="outlined" />
                    ) : (
                      <Chip size="small" label="Active" color="success" variant="outlined" />
                    )}
                  </TableCell>
                  <TableCell align="right">
                    {!r.revokedAt && (
                      <Tooltip title="Revoke — immediate and irreversible">
                        <IconButton size="small" color="error" onClick={() => revoke(r)}>
                          <BlockIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onClose={() => !busy && setCreateOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Generate API key</DialogTitle>
        <DialogContent>
          <Stack gap={2} sx={{ mt: 1 }}>
            <TextField
              autoFocus
              fullWidth
              label="Name"
              placeholder="e.g. Weighbridge feed, Zapier"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <FormControlLabel
              control={<Switch checked={newAutoPost} onChange={(e) => setNewAutoPost(e.target.checked)} />}
              label={
                <Box>
                  <Typography variant="body2">Auto-post to GL</Typography>
                  <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    Off (recommended): documents wait in the Posting Queue for accountant review.
                  </Typography>
                </Box>
              }
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="contained" onClick={mint} disabled={busy}>
            {busy ? "Generating…" : "Generate"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Show-once plaintext dialog */}
      <Dialog open={!!mintedKey} maxWidth="sm" fullWidth>
        <DialogTitle>API key created</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            Copy this key now — it is shown <strong>only once</strong> and cannot be retrieved later.
          </Alert>
          <Box
            sx={{
              p: 1.5,
              borderRadius: 1,
              border: "1px solid var(--field-border)",
              backgroundColor: "background.default",
              fontFamily: "monospace",
              fontSize: "0.85rem",
              wordBreak: "break-all",
              display: "flex",
              alignItems: "center",
              gap: 1,
            }}
          >
            <Box sx={{ flex: 1 }}>{mintedKey}</Box>
            <IconButton size="small" onClick={copyMinted}>
              <ContentCopyIcon fontSize="small" />
            </IconButton>
          </Box>
          <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mt: 1.5 }}>
            Use it as <code>Authorization: Bearer &lt;key&gt;</code> against <code>/v1/documents</code>.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button
            variant="contained"
            onClick={() => {
              setMintedKey(null);
              setCreateOpen(false);
            }}
          >
            I&apos;ve copied it
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
