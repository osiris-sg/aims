"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  InputAdornment,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
  alpha,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import SyncIcon from "@mui/icons-material/Sync";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import LinkIcon from "@mui/icons-material/Link";
import SearchIcon from "@mui/icons-material/Search";
import AddIcon from "@mui/icons-material/Add";
import { toast } from "react-toastify";
import { useAccountingApi } from "../../_lib/api";

// ---------------------------------------------------------------------------
// Xero integration workspace.
//   - Connection status + Connect button (delegates to the existing /xero/connect
//     OAuth flow on the legacy controller).
//   - Sync runs: a "Sync Now" button and a history list.
//   - Account mappings: every Xero account ↔ AIMS account, with confidence,
//     source, and inline editor.
// ---------------------------------------------------------------------------

type Status = {
  connected: boolean;
  tenantId?: string;
  accessTokenExpiresAt?: string;
  expired?: boolean;
  lastSync?: {
    id: string;
    status: string;
    startedAt: string;
    finishedAt: string | null;
    counts: any;
  } | null;
  mappingStats?: { total: number; mapped: number; unmapped: number };
};

type Mapping = {
  id: string;
  xeroAccountId: string;
  xeroAccountCode: string | null;
  xeroAccountName: string;
  xeroAccountType: string | null;
  aimsAccountId: string | null;
  aimsAccountCode: string;
  source: "AUTO" | "MANUAL" | "CREATED";
  confidence: number | null;
  reason: string | null;
  confirmedAt: string | null;
};

type Account = { id: string; code: string; name: string; isActive: boolean };

type Run = {
  id: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  scope: any;
  counts: any;
  errors: any;
};

export default function XeroIntegrationPage() {
  const { request } = useAccountingApi();
  const [status, setStatus] = useState<Status | null>(null);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [autoMapping, setAutoMapping] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "unmapped" | "auto" | "manual">("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, m, r, a] = await Promise.all([
        request<Status>("/xero-sync/status"),
        request<Mapping[]>("/xero-sync/account-mappings"),
        request<Run[]>("/xero-sync/runs"),
        request<Account[]>("/accounting/accounts"),
      ]);
      setStatus(s);
      setMappings(m || []);
      setRuns(r || []);
      setAccounts((a || []).filter((x) => x.isActive).sort((x, y) => x.code.localeCompare(y.code)));
    } catch (e: any) {
      toast.error(e?.message || "Failed to load Xero status");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    load();
  }, [load]);

  const connect = () => {
    // Existing legacy controller: GET /xero/connect?organizationId=... → redirects to Xero OAuth
    const apiBase = process.env.NEXT_PUBLIC_BACKEND_API_URL;
    // organizationId is read by backend from the query; existing flow needs it.
    // We pass an empty value — backend resolves from req if possible.
    window.location.href = `${apiBase}/xero/connect`;
  };

  const syncNow = async () => {
    setSyncing(true);
    try {
      await request("/xero-sync/run", {
        method: "POST",
        body: JSON.stringify({ scope: { accounts: true, contacts: true } }),
      });
      toast.success("Sync complete");
      load();
    } catch (e: any) {
      toast.error(e?.message || "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const autoMap = async () => {
    setAutoMapping(true);
    try {
      const r = await request<{ suggested: number }>("/xero-sync/account-mappings/auto-map", { method: "POST" });
      toast.success(`AI suggested ${r.suggested} mapping(s) — review below`);
      load();
    } catch (e: any) {
      toast.error(e?.message || "Auto-map failed");
    } finally {
      setAutoMapping(false);
    }
  };

  const setMapping = async (m: Mapping, aimsAccountId: string | null) => {
    try {
      await request(`/xero-sync/account-mappings/${m.xeroAccountId}`, {
        method: "PATCH",
        body: JSON.stringify({ aimsAccountId }),
      });
      load();
    } catch (e: any) {
      toast.error(e?.message || "Save failed");
    }
  };

  const createFromXero = async (m: Mapping) => {
    if (!confirm(`Create a new AIMS account "${m.xeroAccountCode || ""} ${m.xeroAccountName}" and link it?`)) return;
    try {
      await request(`/xero-sync/account-mappings/${m.xeroAccountId}/create-aims`, { method: "POST" });
      toast.success("Created + linked");
      load();
    } catch (e: any) {
      toast.error(e?.message || "Create failed");
    }
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let m = mappings;
    if (filter === "unmapped") m = m.filter((x) => !x.aimsAccountId);
    else if (filter === "auto") m = m.filter((x) => x.source === "AUTO" && x.aimsAccountId);
    else if (filter === "manual") m = m.filter((x) => x.source === "MANUAL" || x.source === "CREATED");
    if (!q) return m;
    return m.filter(
      (x) =>
        (x.xeroAccountCode || "").toLowerCase().includes(q) ||
        x.xeroAccountName.toLowerCase().includes(q) ||
        x.aimsAccountCode.toLowerCase().includes(q),
    );
  }, [mappings, search, filter]);

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
      <Box>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          Xero Integration
        </Typography>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          Pull-only: import Xero's chart of accounts and contacts into AIMS. Account-mapping is reviewed once, then re-syncs are quiet.
        </Typography>
      </Box>

      {/* Connection card */}
      {loading && !status ? (
        <Paper variant="outlined" sx={{ p: 3, textAlign: "center" }}>
          <CircularProgress size={24} />
        </Paper>
      ) : !status?.connected ? (
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Stack direction="row" gap={2} alignItems="center">
            <LinkIcon sx={{ color: "text.disabled", fontSize: 28 }} />
            <Box sx={{ flex: 1 }}>
              <Typography variant="body1" sx={{ fontWeight: 600 }}>
                Not connected
              </Typography>
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                Authorize AIMS to read your Xero org.
              </Typography>
            </Box>
            <Button variant="contained" startIcon={<LinkIcon />} onClick={connect}>
              Connect Xero
            </Button>
          </Stack>
        </Paper>
      ) : (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack direction="row" gap={3} alignItems="center" flexWrap="wrap">
            <Stack direction="row" gap={1.5} alignItems="center">
              <CheckCircleIcon sx={{ color: status.expired ? "warning.main" : "success.main" }} />
              <Box>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {status.expired ? "Connected (token expired)" : "Connected"}
                </Typography>
                <Typography variant="caption" sx={{ color: "text.secondary" }}>
                  Tenant {status.tenantId?.slice(0, 8)}…
                </Typography>
              </Box>
            </Stack>
            <Box sx={{ flex: 1 }} />
            <Stat label="Mappings" value={`${status.mappingStats?.mapped ?? 0} / ${status.mappingStats?.total ?? 0}`} />
            <Stat
              label="Last sync"
              value={status.lastSync ? new Date(status.lastSync.startedAt).toLocaleString() : "Never"}
              accent={status.lastSync?.status === "SUCCESS" ? "success" : status.lastSync?.status === "FAILED" ? "error" : status.lastSync?.status === "PARTIAL" ? "warning" : undefined}
            />
            <Button startIcon={<RefreshIcon />} variant="outlined" size="small" onClick={load}>
              Refresh
            </Button>
            <Button
              startIcon={syncing ? <CircularProgress size={14} color="inherit" /> : <SyncIcon />}
              variant="contained"
              size="small"
              onClick={syncNow}
              disabled={syncing || status.expired}
            >
              {syncing ? "Syncing..." : "Sync Now"}
            </Button>
          </Stack>
          {status.expired && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              Access token expired. Click <strong>Connect Xero</strong> again to refresh.
            </Alert>
          )}
        </Paper>
      )}

      {/* Mappings */}
      {status?.connected && (
        <>
          <Paper variant="outlined" sx={{ p: 1.5 }}>
            <Stack direction="row" gap={1.5} alignItems="center" flexWrap="wrap">
              <Typography variant="overline" sx={{ fontWeight: 700, mr: 1 }}>
                Account mappings
              </Typography>
              <Chip
                size="small"
                label="All"
                variant={filter === "all" ? "filled" : "outlined"}
                onClick={() => setFilter("all")}
              />
              <Chip
                size="small"
                label="Unmapped"
                color="warning"
                variant={filter === "unmapped" ? "filled" : "outlined"}
                onClick={() => setFilter("unmapped")}
              />
              <Chip
                size="small"
                label="Auto"
                color="info"
                variant={filter === "auto" ? "filled" : "outlined"}
                onClick={() => setFilter("auto")}
              />
              <Chip
                size="small"
                label="Manual"
                color="success"
                variant={filter === "manual" ? "filled" : "outlined"}
                onClick={() => setFilter("manual")}
              />
              <Box sx={{ flex: 1 }} />
              <TextField
                size="small"
                placeholder="Search code or name"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                InputProps={{
                  startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>,
                }}
                sx={{ minWidth: 240 }}
              />
              <Button
                startIcon={autoMapping ? <CircularProgress size={14} /> : <AutoAwesomeIcon />}
                variant="outlined"
                size="small"
                onClick={autoMap}
                disabled={autoMapping}
              >
                AI auto-map unmapped
              </Button>
            </Stack>
          </Paper>

          <TableContainer component={Paper} variant="outlined">
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700, width: 130 }}>Xero code</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Xero name</TableCell>
                  <TableCell sx={{ fontWeight: 700, width: 110 }}>Xero type</TableCell>
                  <TableCell sx={{ fontWeight: 700, minWidth: 320 }}>Mapped to AIMS account</TableCell>
                  <TableCell sx={{ fontWeight: 700, width: 100 }}>Source</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {visible.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ py: 4, color: "text.secondary" }}>
                      {mappings.length === 0
                        ? "No mappings yet. Hit Sync Now to pull from Xero."
                        : "No mappings match this filter."}
                    </TableCell>
                  </TableRow>
                )}
                {visible.map((m) => {
                  const isUnmapped = !m.aimsAccountId;
                  return (
                    <TableRow
                      key={m.id}
                      hover
                      sx={{ bgcolor: isUnmapped ? (t) => alpha(t.palette.warning.main, 0.04) : undefined }}
                    >
                      <TableCell sx={{ fontFamily: "monospace", fontWeight: 600 }}>
                        {m.xeroAccountCode || "—"}
                      </TableCell>
                      <TableCell>{m.xeroAccountName}</TableCell>
                      <TableCell sx={{ fontSize: "0.7rem", color: "text.secondary" }}>
                        {m.xeroAccountType || "—"}
                      </TableCell>
                      <TableCell>
                        <Autocomplete
                          size="small"
                          options={accounts}
                          value={accounts.find((a) => a.id === m.aimsAccountId) || null}
                          onChange={(_, v) => setMapping(m, v?.id || null)}
                          getOptionLabel={(o) => `${o.code} — ${o.name}`}
                          renderInput={(params) => (
                            <TextField {...params} placeholder="Pick AIMS account…" sx={{ minWidth: 280 }} />
                          )}
                        />
                        {m.reason && (
                          <Typography variant="caption" sx={{ color: "text.secondary", fontSize: "0.7rem" }}>
                            {m.reason}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <Stack gap={0.5}>
                          <Chip
                            size="small"
                            variant="outlined"
                            color={
                              m.source === "MANUAL" || m.source === "CREATED"
                                ? "success"
                                : isUnmapped
                                ? "warning"
                                : "info"
                            }
                            label={m.source}
                            sx={{ fontSize: "0.65rem", height: 18 }}
                          />
                          {m.confidence !== null && (
                            <Typography variant="caption" sx={{ fontSize: "0.65rem", color: "text.secondary" }}>
                              {(m.confidence * 100).toFixed(0)}%
                            </Typography>
                          )}
                        </Stack>
                      </TableCell>
                      <TableCell align="right">
                        {isUnmapped && (
                          <Tooltip title="Create a new AIMS account from this Xero account">
                            <IconButton size="small" onClick={() => createFromXero(m)}>
                              <AddIcon fontSize="small" />
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

          {/* Run history */}
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="overline" sx={{ fontWeight: 700, color: "text.secondary" }}>
              Recent sync runs
            </Typography>
            {runs.length === 0 ? (
              <Typography variant="body2" sx={{ color: "text.secondary", mt: 1 }}>
                None yet.
              </Typography>
            ) : (
              <Table size="small" sx={{ mt: 1 }}>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700, fontSize: "0.7rem" }}>Started</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: "0.7rem" }}>Status</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: "0.7rem" }}>Counts</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: "0.7rem" }}>Errors</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {runs.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell sx={{ fontSize: "0.8125rem" }}>{new Date(r.startedAt).toLocaleString()}</TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          variant="outlined"
                          label={r.status}
                          color={
                            r.status === "SUCCESS"
                              ? "success"
                              : r.status === "FAILED"
                              ? "error"
                              : r.status === "PARTIAL"
                              ? "warning"
                              : "default"
                          }
                          sx={{ fontSize: "0.65rem", height: 18 }}
                        />
                      </TableCell>
                      <TableCell sx={{ fontFamily: "monospace", fontSize: "0.7rem", color: "text.secondary" }}>
                        {r.counts
                          ? Object.entries(r.counts)
                              .map(([k, v]) => `${k}=${v}`)
                              .join(" · ")
                          : "—"}
                      </TableCell>
                      <TableCell sx={{ fontSize: "0.7rem", color: "error.main" }}>
                        {r.errors ? JSON.stringify(r.errors).slice(0, 100) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Paper>
        </>
      )}
    </Box>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: "success" | "warning" | "error" }) {
  return (
    <Box
      sx={{
        px: 1.5,
        py: 0.75,
        borderRadius: 1,
        borderLeft: accent ? 3 : 0,
        borderLeftColor: accent ? `${accent}.main` : undefined,
        bgcolor: (t) => alpha(t.palette.text.primary, 0.02),
      }}
    >
      <Typography variant="caption" sx={{ color: "text.secondary", textTransform: "uppercase", fontSize: "0.65rem", fontWeight: 700 }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {value}
      </Typography>
    </Box>
  );
}
