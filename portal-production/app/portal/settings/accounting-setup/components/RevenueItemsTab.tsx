"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  alpha,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import SearchIcon from "@mui/icons-material/Search";
import { toast } from "react-toastify";

type Asset = { id: string; name: string; skuKey?: string; salesAccountCode?: string | null; rentalAccountCode?: string | null };
type Service = { id: string; name: string; unitPrice?: number | null; accountCode: string; accountName?: string | null; isActive: boolean };

type Props = {
  accounts: any[];
  authedFetch: (path: string, init?: RequestInit) => Promise<Response>;
};

export default function RevenueItemsTab({ accounts, authedFetch }: Props) {
  const [section, setSection] = useState<"equipment" | "services">("equipment");
  const revenueAccounts = useMemo(
    () => (accounts || []).filter((a) => ["SALES", "INCOME"].includes(a.accountType)).sort((a, b) => String(a.code).localeCompare(String(b.code))),
    [accounts],
  );

  return (
    <Box>
      <Box sx={{ mb: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>Revenue Mapping</Typography>
        <Typography variant="body2" sx={{ color: "text.secondary", maxWidth: 760 }}>
          Map each product and service to a GL revenue account. Set once — every invoice line then self-codes and posts to the ledger automatically.
        </Typography>
      </Box>

      <ToggleButtonGroup exclusive size="small" value={section} onChange={(_, v) => v && setSection(v)} sx={{ mb: 2 }}>
        <ToggleButton value="equipment" sx={{ px: 2 }}>Equipment / Products</ToggleButton>
        <ToggleButton value="services" sx={{ px: 2 }}>Services</ToggleButton>
      </ToggleButtonGroup>

      {section === "equipment" ? (
        <EquipmentSection revenueAccounts={revenueAccounts} authedFetch={authedFetch} />
      ) : (
        <ServicesSection revenueAccounts={revenueAccounts} authedFetch={authedFetch} />
      )}
    </Box>
  );
}

// ---------- Equipment: inline sale / rental account editor over Assets ----------
function EquipmentSection({ revenueAccounts, authedFetch }: { revenueAccounts: any[]; authedFetch: Props["authedFetch"] }) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authedFetch("/assets", { method: "POST", body: JSON.stringify({ page: 1, limit: 1000, status: "all" }) });
      const json = await res.json();
      const docs = json?.data?.docs ?? json?.docs ?? [];
      setAssets(docs.map((a: any) => ({ id: a.id, name: a.name, skuKey: a.skuKey, salesAccountCode: a.salesAccountCode ?? null, rentalAccountCode: a.rentalAccountCode ?? null })));
    } catch {
      toast.error("Failed to load products");
    } finally {
      setLoading(false);
    }
  }, [authedFetch]);
  useEffect(() => { load(); }, [load]);

  const save = async (asset: Asset, field: "salesAccountCode" | "rentalAccountCode", value: string) => {
    const v = value || null;
    setAssets((prev) => prev.map((a) => (a.id === asset.id ? { ...a, [field]: v } : a)));
    setSavingId(asset.id);
    try {
      const res = await authedFetch("/assets/update", { method: "PUT", body: JSON.stringify({ id: asset.id, [field]: v }) });
      if (!res.ok) throw new Error();
    } catch {
      toast.error("Save failed");
      load();
    } finally {
      setSavingId(null);
    }
  };

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return assets;
    return assets.filter((a) => a.name.toLowerCase().includes(s) || (a.skuKey || "").toLowerCase().includes(s));
  }, [assets, q]);
  const mapped = assets.filter((a) => a.salesAccountCode || a.rentalAccountCode).length;

  return (
    <Box>
      <Stack direction="row" gap={1.5} alignItems="center" sx={{ mb: 1.5 }}>
        <TextField size="small" placeholder="Search products…" value={q} onChange={(e) => setQ(e.target.value)} sx={{ minWidth: 280 }} InputProps={{ startAdornment: <SearchIcon fontSize="small" sx={{ color: "text.secondary", mr: 1 }} /> }} />
        <Typography variant="caption" sx={{ color: "text.secondary" }}>{mapped} of {assets.length} products mapped</Typography>
      </Stack>
      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", p: 5 }}><CircularProgress /></Box>
      ) : (
        <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2, maxHeight: 520 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>Product</TableCell>
                <TableCell sx={{ fontWeight: 700, width: 300 }}>Sales account</TableCell>
                <TableCell sx={{ fontWeight: 700, width: 300 }}>Rental account</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.map((a) => (
                <TableRow key={a.id} sx={{ opacity: savingId === a.id ? 0.6 : 1 }}>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{a.name}</Typography>
                    {a.skuKey && <Typography variant="caption" sx={{ color: "text.secondary" }}>{a.skuKey}</Typography>}
                  </TableCell>
                  <TableCell>
                    <AccountSelect value={a.salesAccountCode || ""} accounts={revenueAccounts} onChange={(v) => save(a, "salesAccountCode", v)} />
                  </TableCell>
                  <TableCell>
                    <AccountSelect value={a.rentalAccountCode || ""} accounts={revenueAccounts} onChange={(v) => save(a, "rentalAccountCode", v)} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mt: 1 }}>
        Setting a rental account makes the product appear in the Stock Card's Rental tab; a sales account → Sales tab. Both can be set.
      </Typography>
    </Box>
  );
}

function AccountSelect({ value, accounts, onChange }: { value: string; accounts: any[]; onChange: (v: string) => void }) {
  return (
    <TextField select fullWidth size="small" value={value} onChange={(e) => onChange(e.target.value)}>
      <MenuItem value=""><em>— none —</em></MenuItem>
      {accounts.map((a) => (<MenuItem key={a.code} value={a.code}>{a.code} — {a.name}</MenuItem>))}
    </TextField>
  );
}

// ---------- Services: RevenueItem CRUD (services only) ----------
const blankSvc = { name: "", unitPrice: "", accountCode: "" };
function ServicesSection({ revenueAccounts, authedFetch }: { revenueAccounts: any[]; authedFetch: Props["authedFetch"] }) {
  const [items, setItems] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Service | null>(null);
  const [form, setForm] = useState<any>(blankSvc);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authedFetch("/revenue-items?type=SERVICE");
      const json = await res.json();
      const list = json?.data ?? json;
      setItems(Array.isArray(list) ? list : []);
    } catch {
      toast.error("Failed to load services");
    } finally {
      setLoading(false);
    }
  }, [authedFetch]);
  useEffect(() => { load(); }, [load]);

  const openNew = () => { setEditing(null); setForm(blankSvc); setDialogOpen(true); };
  const openEdit = (it: Service) => { setEditing(it); setForm({ name: it.name, unitPrice: it.unitPrice ?? "", accountCode: it.accountCode }); setDialogOpen(true); };

  const save = async () => {
    if (!form.name.trim()) { toast.warn("Name is required"); return; }
    if (!form.accountCode) { toast.warn("Pick a GL account"); return; }
    setSaving(true);
    try {
      const payload = { name: form.name.trim(), type: "SERVICE", unitPrice: form.unitPrice === "" ? null : parseFloat(form.unitPrice), accountCode: form.accountCode };
      const res = editing
        ? await authedFetch(`/revenue-items/${editing.id}`, { method: "PATCH", body: JSON.stringify(payload) })
        : await authedFetch("/revenue-items", { method: "POST", body: JSON.stringify(payload) });
      if (!res.ok) throw new Error();
      toast.success(editing ? "Updated" : "Added");
      setDialogOpen(false);
      load();
    } catch {
      toast.error("Save failed");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (it: Service) => {
    if (!confirm(`Delete "${it.name}"?`)) return;
    try {
      const res = await authedFetch(`/revenue-items/${it.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Deleted");
      load();
    } catch {
      toast.error("Delete failed");
    }
  };

  return (
    <Box>
      <Stack direction="row" justifyContent="flex-end" sx={{ mb: 1.5 }}>
        <Button startIcon={<AddIcon />} variant="contained" onClick={openNew}>Add service</Button>
      </Stack>
      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", p: 5 }}><CircularProgress /></Box>
      ) : items.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 5, textAlign: "center", borderRadius: 2 }}>
          <Typography variant="body2" sx={{ color: "text.secondary", mb: 2 }}>No services yet. Add each service and map it to a GL account.</Typography>
          <Button startIcon={<AddIcon />} variant="outlined" onClick={openNew}>Add your first service</Button>
        </Paper>
      ) : (
        <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: (t) => alpha(t.palette.text.primary, 0.03) }}>
                <TableCell sx={{ fontWeight: 700 }}>Service</TableCell>
                <TableCell sx={{ fontWeight: 700 }} align="right">Unit price</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>GL account</TableCell>
                <TableCell sx={{ fontWeight: 700 }} align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((it) => (
                <TableRow key={it.id}>
                  <TableCell><Typography variant="body2" sx={{ fontWeight: 600 }}>{it.name}</Typography></TableCell>
                  <TableCell align="right" sx={{ fontFamily: "monospace" }}>{it.unitPrice != null ? it.unitPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}</TableCell>
                  <TableCell><Typography variant="body2"><b>{it.accountCode}</b> {it.accountName ? `— ${it.accountName}` : ""}</Typography></TableCell>
                  <TableCell align="right">
                    <Tooltip title="Edit"><IconButton size="small" onClick={() => openEdit(it)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                    <Tooltip title="Delete"><IconButton size="small" onClick={() => remove(it)}><DeleteOutlineIcon fontSize="small" /></IconButton></Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Dialog open={dialogOpen} onClose={() => !saving && setDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{editing ? "Edit service" : "Add service"}</DialogTitle>
        <DialogContent dividers>
          <Stack gap={2} sx={{ mt: 0.5 }}>
            <TextField label="Service name" fullWidth size="small" value={form.name} onChange={(e) => setForm((f: any) => ({ ...f, name: e.target.value }))} placeholder="e.g. Transportation of Hardcore" />
            <TextField label="Default unit price (optional)" size="small" type="number" value={form.unitPrice} onChange={(e) => setForm((f: any) => ({ ...f, unitPrice: e.target.value }))} />
            <TextField select label="GL revenue account" fullWidth size="small" value={form.accountCode} onChange={(e) => setForm((f: any) => ({ ...f, accountCode: e.target.value }))}>
              {revenueAccounts.map((a) => (<MenuItem key={a.code} value={a.code}>{a.code} — {a.name}</MenuItem>))}
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
          <Button variant="contained" onClick={save} disabled={saving} startIcon={saving ? <CircularProgress size={14} color="inherit" /> : undefined}>{editing ? "Save" : "Add"}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
