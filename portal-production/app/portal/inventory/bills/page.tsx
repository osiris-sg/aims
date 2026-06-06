"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  InputAdornment,
  Paper,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
  alpha,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import RefreshIcon from "@mui/icons-material/Refresh";
import SearchIcon from "@mui/icons-material/Search";
import CheckIcon from "@mui/icons-material/Check";
import ClearIcon from "@mui/icons-material/Clear";
import VisibilityIcon from "@mui/icons-material/Visibility";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { toast } from "react-toastify";
import { useAccountingApi } from "../../accounting/_lib/api";
import BillEditorDialog from "./_components/BillEditorDialog";

type Bill = {
  id: string;
  billNumber: string;
  billDate: string;
  dueDate?: string | null;
  status: "DRAFT" | "PENDING_APPROVAL" | "POSTED" | "PAID" | "VOID";
  totalAmount: number;
  taxAmount: number;
  subtotal: number;
  amountPaid: number;
  matchStatus?: string | null;
  inboundChannel?: string | null;
  supplier?: { id: string; name: string } | null;
};

const STATUS_COLOR: Record<string, "default" | "info" | "warning" | "success" | "error"> = {
  DRAFT: "default",
  PENDING_APPROVAL: "warning",
  POSTED: "info",
  PAID: "success",
  VOID: "error",
};

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function BillsPage() {
  const { request } = useAccountingApi();
  const [items, setItems] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"all" | "DRAFT" | "PENDING_APPROVAL" | "POSTED" | "PAID" | "VOID">("all");
  const [search, setSearch] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Bill | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request<Bill[]>("/bills");
      setItems(res || []);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load bills");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(() => {
    const c = { all: items.length, DRAFT: 0, PENDING_APPROVAL: 0, POSTED: 0, PAID: 0, VOID: 0 };
    for (const b of items) (c as any)[b.status] = ((c as any)[b.status] ?? 0) + 1;
    return c;
  }, [items]);

  const visible = useMemo(() => {
    const filtered = tab === "all" ? items : items.filter((b) => b.status === tab);
    const q = search.trim().toLowerCase();
    if (!q) return filtered;
    return filtered.filter(
      (b) =>
        b.billNumber.toLowerCase().includes(q) ||
        (b.supplier?.name || "").toLowerCase().includes(q),
    );
  }, [items, tab, search]);

  const totals = useMemo(() => {
    return visible.reduce(
      (s, b) => ({
        total: s.total + b.totalAmount,
        outstanding:
          s.outstanding + (b.status === "POSTED" ? Math.max(0, b.totalAmount - (b.amountPaid || 0)) : 0),
      }),
      { total: 0, outstanding: 0 },
    );
  }, [visible]);

  const submitDraft = async (b: Bill) => {
    try {
      await request(`/bills/${b.id}/submit`, { method: "POST" });
      toast.success("Submitted — see status");
      load();
    } catch (e: any) {
      toast.error(e?.message || "Submit failed");
    }
  };
  const approve = async (b: Bill) => {
    try {
      await request(`/bills/${b.id}/approve`, { method: "POST" });
      toast.success("Approved + posted");
      load();
    } catch (e: any) {
      toast.error(e?.message || "Approve failed");
    }
  };
  const reject = async (b: Bill) => {
    if (!confirm("Reject and send back to DRAFT?")) return;
    try {
      await request(`/bills/${b.id}/reject`, { method: "POST" });
      toast.success("Rejected");
      load();
    } catch (e: any) {
      toast.error(e?.message || "Reject failed");
    }
  };
  const voidIt = async (b: Bill) => {
    if (!confirm("Void this bill? Reversing JE will be created if it was posted.")) return;
    try {
      await request(`/bills/${b.id}`, { method: "DELETE" });
      toast.success("Voided");
      load();
    } catch (e: any) {
      toast.error(e?.message || "Void failed");
    }
  };

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            Bills
          </Typography>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            Supplier bills. Submit → optional approval → posts to GL as a payable.
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
            New Bill
          </Button>
        </Stack>
      </Stack>

      {/* KPI row */}
      <Stack direction="row" gap={2}>
        <Paper variant="outlined" sx={{ p: 1.5, minWidth: 180 }}>
          <Typography variant="caption" sx={{ color: "text.secondary", textTransform: "uppercase", fontWeight: 700, fontSize: "0.65rem" }}>
            Visible bills
          </Typography>
          <Typography sx={{ fontFamily: "monospace", fontWeight: 700, fontSize: "1.125rem", mt: 0.25 }}>
            {visible.length}
          </Typography>
        </Paper>
        <Paper variant="outlined" sx={{ p: 1.5, minWidth: 180, borderLeft: 3, borderLeftColor: "warning.main" }}>
          <Typography variant="caption" sx={{ color: "text.secondary", textTransform: "uppercase", fontWeight: 700, fontSize: "0.65rem" }}>
            Outstanding (posted)
          </Typography>
          <Typography sx={{ fontFamily: "monospace", fontWeight: 700, fontSize: "1.125rem", mt: 0.25 }}>
            {fmt(totals.outstanding)}
          </Typography>
        </Paper>
        <Paper variant="outlined" sx={{ p: 1.5, minWidth: 180 }}>
          <Typography variant="caption" sx={{ color: "text.secondary", textTransform: "uppercase", fontWeight: 700, fontSize: "0.65rem" }}>
            Total billed
          </Typography>
          <Typography sx={{ fontFamily: "monospace", fontWeight: 700, fontSize: "1.125rem", mt: 0.25 }}>
            {fmt(totals.total)}
          </Typography>
        </Paper>
      </Stack>

      {/* Status tabs */}
      <Paper variant="outlined" sx={{ borderRadius: 1.5 }}>
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          sx={{ px: 1, minHeight: 40, "& .MuiTab-root": { minHeight: 40, textTransform: "none", fontWeight: 600 } }}
        >
          <Tab value="all" label={<TabLabel text="All" count={counts.all} />} />
          <Tab value="DRAFT" label={<TabLabel text="Draft" count={counts.DRAFT} />} />
          <Tab
            value="PENDING_APPROVAL"
            label={<TabLabel text="Pending Approval" count={counts.PENDING_APPROVAL} tone="warning" />}
          />
          <Tab value="POSTED" label={<TabLabel text="Posted" count={counts.POSTED} tone="info" />} />
          <Tab value="PAID" label={<TabLabel text="Paid" count={counts.PAID} tone="success" />} />
          <Tab value="VOID" label={<TabLabel text="Void" count={counts.VOID} />} />
        </Tabs>
      </Paper>

      {/* Toolbar */}
      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Stack direction="row" alignItems="center">
          <TextField
            size="small"
            placeholder="Find by bill # or supplier"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ minWidth: 280 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
          />
        </Stack>
      </Paper>

      {/* Table */}
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 700 }}>Bill #</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Supplier</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Bill date</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Due</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700 }}>Total</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700 }}>Outstanding</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Channel</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700 }}>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={9} align="center" sx={{ py: 4 }}>
                  <CircularProgress size={20} />
                </TableCell>
              </TableRow>
            )}
            {!loading && visible.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} align="center" sx={{ py: 4, color: "text.secondary" }}>
                  No bills in this view. Click "New Bill" to create one — or convert an existing PO into a bill.
                </TableCell>
              </TableRow>
            )}
            {visible.map((b) => {
              const outstanding = b.status === "POSTED" ? Math.max(0, b.totalAmount - (b.amountPaid || 0)) : 0;
              return (
                <TableRow key={b.id} hover>
                  <TableCell sx={{ fontFamily: "monospace", fontWeight: 600 }}>
                    {b.billNumber}
                    {b.matchStatus && b.matchStatus !== "MATCHED" && (
                      <Tooltip title={`3-way match issue: ${b.matchStatus}`}>
                        <Chip
                          size="small"
                          label="!"
                          color="warning"
                          sx={{ ml: 0.5, height: 14, fontSize: "0.55rem", "& .MuiChip-label": { px: 0.5 } }}
                        />
                      </Tooltip>
                    )}
                  </TableCell>
                  <TableCell>{b.supplier?.name || "—"}</TableCell>
                  <TableCell sx={{ fontSize: "0.8125rem" }}>{new Date(b.billDate).toLocaleDateString()}</TableCell>
                  <TableCell sx={{ fontSize: "0.8125rem", color: "text.secondary" }}>
                    {b.dueDate ? new Date(b.dueDate).toLocaleDateString() : "—"}
                  </TableCell>
                  <TableCell align="right" sx={{ fontFamily: "monospace" }}>{fmt(b.totalAmount)}</TableCell>
                  <TableCell align="right" sx={{ fontFamily: "monospace", fontWeight: outstanding > 0 ? 600 : 400 }}>
                    {b.status === "POSTED" ? fmt(outstanding) : "—"}
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      variant="outlined"
                      color={STATUS_COLOR[b.status] || "default"}
                      label={b.status.replace("_", " ")}
                      sx={{ fontSize: "0.7rem" }}
                    />
                  </TableCell>
                  <TableCell sx={{ fontSize: "0.7rem", color: "text.secondary" }}>
                    {b.inboundChannel || "MANUAL"}
                  </TableCell>
                  <TableCell align="right">
                    {b.status === "DRAFT" && (
                      <Button size="small" variant="outlined" onClick={() => submitDraft(b)} sx={{ mr: 0.5 }}>
                        Submit
                      </Button>
                    )}
                    {b.status === "PENDING_APPROVAL" && (
                      <>
                        <Tooltip title="Approve + Post">
                          <IconButton size="small" onClick={() => approve(b)} sx={{ color: "success.main" }}>
                            <CheckIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Reject (back to draft)">
                          <IconButton size="small" onClick={() => reject(b)} sx={{ color: "error.main" }}>
                            <ClearIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </>
                    )}
                    <Tooltip title="View / edit">
                      <IconButton size="small" onClick={() => { setEditing(b); setEditorOpen(true); }}>
                        <VisibilityIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    {b.status !== "VOID" && (
                      <Tooltip title="Void">
                        <IconButton size="small" onClick={() => voidIt(b)}>
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      <BillEditorDialog
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

function TabLabel({ text, count, tone }: { text: string; count: number; tone?: "info" | "warning" | "success" }) {
  return (
    <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.75 }}>
      {text}
      <Chip
        size="small"
        label={count}
        variant="outlined"
        color={tone ?? "default"}
        sx={{ height: 18, fontSize: "0.65rem", "& .MuiChip-label": { px: 0.75 } }}
      />
    </Box>
  );
}
