"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import RefreshIcon from "@mui/icons-material/Refresh";
import { useAuth } from "@clerk/nextjs";
import { toast } from "react-toastify";

type CostCenter = {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  parentId?: string | null;
  isActive: boolean;
};

export default function CostCentersTab() {
  const { getToken } = useAuth();
  const apiBase = process.env.NEXT_PUBLIC_BACKEND_API_URL;

  const [items, setItems] = useState<CostCenter[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<CostCenter | null>(null);

  const authedFetch = useCallback(
    async (path: string, init?: RequestInit) => {
      const token = await getToken();
      return fetch(`${apiBase}${path}`, {
        ...init,
        headers: {
          ...(init?.headers || {}),
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
    },
    [apiBase, getToken],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authedFetch("/cost-centers?includeInactive=true");
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      const list = json?.data ?? json;
      setItems(Array.isArray(list) ? list : []);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load cost centers");
    } finally {
      setLoading(false);
    }
  }, [authedFetch]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (cc: CostCenter) => {
    try {
      const res = await authedFetch(`/cost-centers/${cc.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !cc.isActive }),
      });
      if (!res.ok) throw new Error(await res.text());
      load();
    } catch (e: any) {
      toast.error(e?.message || "Toggle failed");
    }
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            Cost Centers
          </Typography>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            Dimensional tag for journal lines. Used for "P&L by department" reporting and budget allocations.
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
            New Cost Center
          </Button>
        </Stack>
      </Stack>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 700, width: 80 }}>Active</TableCell>
              <TableCell sx={{ fontWeight: 700, width: 140 }}>Code</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Description</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Parent</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700 }}>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                  <CircularProgress size={20} />
                </TableCell>
              </TableRow>
            )}
            {!loading && items.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 4, color: "text.secondary" }}>
                  No cost centers yet. Click "New Cost Center" to create the first one.
                </TableCell>
              </TableRow>
            )}
            {items.map((cc) => {
              const parent = cc.parentId ? items.find((p) => p.id === cc.parentId) : null;
              return (
                <TableRow key={cc.id} hover sx={{ opacity: cc.isActive ? 1 : 0.5 }}>
                  <TableCell>
                    <Switch size="small" checked={cc.isActive} onChange={() => toggle(cc)} />
                  </TableCell>
                  <TableCell sx={{ fontFamily: "monospace", fontWeight: 600 }}>{cc.code}</TableCell>
                  <TableCell>{cc.name}</TableCell>
                  <TableCell sx={{ color: "text.secondary" }}>{cc.description || "—"}</TableCell>
                  <TableCell>
                    {parent ? (
                      <Chip size="small" variant="outlined" label={`${parent.code} · ${parent.name}`} sx={{ fontSize: "0.7rem" }} />
                    ) : "—"}
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="Edit">
                      <IconButton size="small" onClick={() => { setEditing(cc); setEditorOpen(true); }}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      <CostCenterEditor
        open={editorOpen}
        editing={editing}
        items={items}
        authedFetch={authedFetch}
        onClose={() => setEditorOpen(false)}
        onSaved={() => {
          setEditorOpen(false);
          load();
        }}
      />
    </Box>
  );
}

function CostCenterEditor({
  open,
  editing,
  items,
  authedFetch,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: CostCenter | null;
  items: CostCenter[];
  authedFetch: (path: string, init?: RequestInit) => Promise<Response>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [parentId, setParentId] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCode(editing?.code || "");
    setName(editing?.name || "");
    setDescription(editing?.description || "");
    setParentId(editing?.parentId || "");
  }, [open, editing]);

  const submit = async () => {
    if (!code.trim() || !name.trim()) return toast.error("Code and name are required");
    setSaving(true);
    try {
      const body = {
        code: code.trim().toUpperCase(),
        name: name.trim(),
        description: description || undefined,
        parentId: parentId || null,
      };
      const url = editing ? `/cost-centers/${editing.id}` : "/cost-centers";
      const res = await authedFetch(url, {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success(editing ? "Updated" : "Created");
      onSaved();
    } catch (e: any) {
      toast.error(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={() => !saving && onClose()} fullWidth maxWidth="sm">
      <DialogTitle>{editing ? "Edit Cost Center" : "New Cost Center"}</DialogTitle>
      <DialogContent dividers>
        <Stack gap={2}>
          <TextField
            label="Code"
            size="small"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            disabled={saving || !!editing}
            inputProps={{ style: { textTransform: "uppercase", fontFamily: "monospace" } }}
            helperText="Short ALL-CAPS code, e.g. OPS, SALES, R&D"
          />
          <TextField
            label="Name"
            size="small"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={saving}
            required
          />
          <TextField
            label="Description (optional)"
            size="small"
            multiline
            minRows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={saving}
          />
          <TextField
            select
            label="Parent (optional)"
            size="small"
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
            disabled={saving}
            SelectProps={{ native: true }}
            InputLabelProps={{ shrink: true }}
          >
            <option value="">— None (top level) —</option>
            {items
              .filter((c) => c.id !== editing?.id) // can't be own parent
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
                </option>
              ))}
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button
          variant="contained"
          onClick={submit}
          disabled={saving}
          startIcon={saving ? <CircularProgress size={14} color="inherit" /> : undefined}
        >
          {editing ? "Save changes" : "Create"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
