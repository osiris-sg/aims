"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputAdornment,
  InputLabel,
  Link,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
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
  ContentCopy as ContentCopyIcon,
  Delete as DeleteIcon,
  ExpandMore as ExpandMoreIcon,
  Refresh as RefreshIcon,
} from "@mui/icons-material";
import { useAuth } from "@clerk/nextjs";
import { toast } from "react-toastify";
import { request } from "@/helpers/request";

// ─────────────────────────────────────────────────────────────────────────────
// Email Ingestion tab (admin org detail page).
//
// Configures the docs+{orgId}@<domain> inbound pipeline: master enable switch,
// watched-sender allow-list, routing mode, deterministic hard rules
// (WHEN field/operator/value THEN action — evaluated server-side before any
// AI call, first match wins), free-text AI guidance appended to the Claude
// classifier prompt, and the EmailIngestLog activity feed.
// Backend: src/ingestion-email/email-config.controller.ts.
// ─────────────────────────────────────────────────────────────────────────────

interface RuleCondition {
  field: "SUBJECT" | "SENDER" | "BODY";
  operator: "CONTAINS" | "EQUALS" | "STARTS_WITH" | "DOMAIN";
  value: string;
}

interface IngestRule {
  conditions: RuleCondition[]; // ANDed — all must match
  action: "IGNORE" | "FORCE_BILL" | "FORCE_INVOICE" | "AI_GUIDANCE";
  guidance: string; // instructions for the AI when action = AI_GUIDANCE
}

interface IngestConfig {
  enabled: boolean;
  watchedSenders: string[];
  routingMode: "AI" | "FIXED";
  defaultDocType: "BILL" | "INVOICE" | null;
  rules: IngestRule[];
  aiGuidance: string;
}

interface IngestLogRow {
  id: string;
  createdAt: string;
  fromAddress: string;
  subject?: string | null;
  status: string;
  reason?: string | null;
  // Newer rows store {id, type}; older ones plain id strings.
  createdDocumentIds?: Array<string | { id: string; type: string }>;
  attachmentCount?: number;
}

// Bills have no per-document route (they open via a dialog on the bills list);
// invoices deep-link into the document editor.
const docHref = (entry: string | { id: string; type: string }) => {
  const id = typeof entry === "string" ? entry : entry.id;
  const type = typeof entry === "string" ? "INVOICE" : entry.type;
  return type === "BILL" ? "/portal/accounting/bills" : `/portal/documents/edit/${type}/${id}`;
};

const docLabel = (entry: string | { id: string; type: string }, index: number) => {
  if (typeof entry === "string") return `#${index + 1}`;
  if (entry.type === "BILL") return "Bill";
  if (entry.type === "CREDIT_NOTE") return "Credit Note";
  return "Invoice";
};

const RULE_FIELDS: Array<{ value: RuleCondition["field"]; label: string }> = [
  { value: "SUBJECT", label: "Subject" },
  { value: "SENDER", label: "Sender" },
  { value: "BODY", label: "Email body" },
];

const RULE_OPERATORS: Array<{ value: RuleCondition["operator"]; label: string; senderOnly?: boolean }> = [
  { value: "CONTAINS", label: "contains" },
  { value: "EQUALS", label: "equals" },
  { value: "STARTS_WITH", label: "starts with" },
  { value: "DOMAIN", label: "is domain", senderOnly: true },
];

const RULE_ACTIONS: Array<{ value: IngestRule["action"]; label: string }> = [
  { value: "IGNORE", label: "Ignore the email" },
  { value: "FORCE_BILL", label: "Always create Bill (AP)" },
  { value: "FORCE_INVOICE", label: "Always create Invoice (AR)" },
  { value: "AI_GUIDANCE", label: "Let AI decide, with instructions…" },
];

const EMPTY_CONDITION: RuleCondition = { field: "SUBJECT", operator: "CONTAINS", value: "" };
const EMPTY_RULE: IngestRule = { conditions: [{ ...EMPTY_CONDITION }], action: "IGNORE", guidance: "" };

const STATUS_CHIP_COLOR: Record<string, "success" | "default" | "error" | "info"> = {
  PARSED: "success",
  IGNORED: "default",
  FAILED: "error",
  RECEIVED: "info",
};

const normalizeConfig = (raw: any): IngestConfig => ({
  enabled: Boolean(raw?.enabled),
  watchedSenders: Array.isArray(raw?.watchedSenders) ? raw.watchedSenders.filter((s: any) => typeof s === "string") : [],
  routingMode: raw?.routingMode === "FIXED" ? "FIXED" : "AI",
  defaultDocType: raw?.defaultDocType === "BILL" || raw?.defaultDocType === "INVOICE" ? raw.defaultDocType : null,
  rules: Array.isArray(raw?.rules)
    ? raw.rules
        .map((r: any) => {
          // Current shape: {conditions:[...]} — legacy rows were flat {field, operator, value}.
          const rawConds = Array.isArray(r?.conditions)
            ? r.conditions
            : r?.field
            ? [{ field: r.field, operator: r.operator, value: r.value }]
            : [];
          const conditions: RuleCondition[] = rawConds
            .filter((c: any) => c && typeof c.value === "string")
            .map((c: any) => ({
              field: ["SUBJECT", "SENDER", "BODY"].includes(c.field) ? c.field : "SUBJECT",
              operator: ["CONTAINS", "EQUALS", "STARTS_WITH", "DOMAIN"].includes(c.operator) ? c.operator : "CONTAINS",
              value: c.value,
            }));
          return {
            conditions: conditions.length > 0 ? conditions : [{ ...EMPTY_CONDITION }],
            action: ["IGNORE", "FORCE_BILL", "FORCE_INVOICE", "AI_GUIDANCE"].includes(r?.action) ? r.action : "IGNORE",
            guidance: typeof r?.guidance === "string" ? r.guidance : "",
          } as IngestRule;
        })
        .filter((r: IngestRule) => r.conditions.some((c) => c.value))
    : [],
  aiGuidance: typeof raw?.aiGuidance === "string" ? raw.aiGuidance : "",
});

export default function EmailIngestionTab({ organizationId }: { organizationId: string }) {
  const { getToken } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<IngestConfig | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [addressNote, setAddressNote] = useState<string | null>(null);
  const [senderInput, setSenderInput] = useState("");
  const [logs, setLogs] = useState<IngestLogRow[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const [cfgRes, addrRes] = await Promise.all([
        request({ path: `/email-ingest/config/${organizationId}`, method: "GET" }, {}, token),
        request({ path: `/email-ingest/address/${organizationId}`, method: "GET" }, {}, token),
      ]);
      // The backend wraps all responses as { success, data, message }
      // (CustomResponseInterceptor) — unwrap before reading fields.
      if (cfgRes && cfgRes.success !== false) setConfig(normalizeConfig(cfgRes.data ?? cfgRes));
      if (addrRes && addrRes.success !== false) {
        const addr = addrRes.data ?? addrRes;
        setAddress(addr.address || null);
        setAddressNote(addr.note || null);
      }
    } catch (e) {
      console.error("Error loading email ingestion config:", e);
      toast.error("Failed to load email ingestion settings");
    } finally {
      setLoading(false);
    }
  }, [getToken, organizationId]);

  const fetchLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const token = await getToken();
      if (!token) return;
      const res = await request({ path: `/email-ingest/logs/${organizationId}?limit=50`, method: "GET" }, {}, token);
      const rows = Array.isArray(res) ? res : res?.data;
      if (Array.isArray(rows)) setLogs(rows);
    } catch (e) {
      console.error("Error loading email ingestion logs:", e);
    } finally {
      setLogsLoading(false);
    }
  }, [getToken, organizationId]);

  useEffect(() => {
    fetchAll();
    fetchLogs();
    // Keyed on the org only: fetchAll/fetchLogs close over Clerk's getToken,
    // whose identity changes across renders — depending on them re-runs this
    // effect every render (setState-in-effect loop + stale responses
    // clobbering fresher state).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  const patch = (partial: Partial<IngestConfig>) => setConfig((c) => (c ? { ...c, ...partial } : c));

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const token = await getToken();
      if (!token) return;
      const res = await request(
        { path: `/email-ingest/config/${organizationId}`, method: "PUT" },
        {
          enabled: config.enabled,
          watchedSenders: config.watchedSenders,
          routingMode: config.routingMode,
          defaultDocType: config.routingMode === "FIXED" ? config.defaultDocType || "BILL" : config.defaultDocType,
          rules: config.rules
            .map((r) => ({ ...r, conditions: r.conditions.filter((c) => c.value.trim().length > 0) }))
            .filter((r) => r.conditions.length > 0),
          aiGuidance: config.aiGuidance,
        },
        token
      );
      if (res && res.success !== false) {
        setConfig(normalizeConfig(res.data ?? res));
        toast.success("Email ingestion settings saved");
      } else {
        toast.error(res?.message || "Failed to save settings");
      }
    } catch (e) {
      console.error("Error saving email ingestion config:", e);
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const addSender = () => {
    const value = senderInput.trim().toLowerCase();
    if (!value || !config) return;
    if (!config.watchedSenders.includes(value)) {
      patch({ watchedSenders: [...config.watchedSenders, value] });
    }
    setSenderInput("");
  };

  const copyAddress = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      toast.success("Address copied");
    } catch {
      toast.error("Could not copy — select and copy manually");
    }
  };

  const updateRule = (index: number, partial: Partial<IngestRule>) => {
    if (!config) return;
    patch({ rules: config.rules.map((r, i) => (i === index ? { ...r, ...partial } : r)) });
  };

  const updateCondition = (ruleIdx: number, condIdx: number, partial: Partial<RuleCondition>) => {
    if (!config) return;
    const rules = config.rules.map((r, i) => {
      if (i !== ruleIdx) return r;
      const conditions = r.conditions.map((c, j) => {
        if (j !== condIdx) return c;
        const next = { ...c, ...partial };
        // "is domain" only makes sense against the sender address.
        if (next.operator === "DOMAIN" && next.field !== "SENDER") next.operator = "CONTAINS";
        return next;
      });
      return { ...r, conditions };
    });
    patch({ rules });
  };

  if (loading || !config) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      {/* Header: title + master switch */}
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", mb: 1 }}>
        <Box>
          <Typography variant="h6">Email Ingestion</Typography>
          <Typography variant="body2" color="text.secondary">
            Auto-import Bills (AP), Invoices (AR) and Credit Notes that clients forward by email. Documents are created
            as drafts for review.
          </Typography>
        </Box>
        <FormControlLabel
          control={<Switch checked={config.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />}
          label={config.enabled ? "Enabled" : "Disabled"}
          labelPlacement="start"
        />
      </Box>
      <Divider sx={{ mb: 3 }} />

      {/* ① Inbound address */}
      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
        ① Inbound address
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Tell the client to forward supplier emails to this address.
      </Typography>
      {address ? (
        <TextField
          value={address}
          size="small"
          fullWidth
          sx={{ maxWidth: 560, mb: 3 }}
          InputProps={{
            readOnly: true,
            endAdornment: (
              <InputAdornment position="end">
                <Tooltip title="Copy address">
                  <IconButton onClick={copyAddress} edge="end" size="small">
                    <ContentCopyIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </InputAdornment>
            ),
          }}
        />
      ) : (
        <Alert severity="warning" sx={{ mb: 3, maxWidth: 560 }}>
          {addressNote || "Inbound address is not configured (EMAIL_INGEST_DOMAIN missing on the backend)."}
        </Alert>
      )}

      {/* ② Watched senders */}
      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
        ② Watched senders (allow-list)
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Full addresses or whole domains (e.g. <code>@daikin.com.sg</code>). Leave empty to accept everything the client
        forwards.
      </Typography>
      <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: "wrap", gap: 1 }}>
        {config.watchedSenders.map((s) => (
          <Chip key={s} label={s} onDelete={() => patch({ watchedSenders: config.watchedSenders.filter((x) => x !== s) })} />
        ))}
        {config.watchedSenders.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ fontStyle: "italic", alignSelf: "center" }}>
            No senders listed — all forwarded mail is accepted.
          </Typography>
        )}
      </Stack>
      <Stack direction="row" spacing={1} sx={{ mb: 3, maxWidth: 560 }}>
        <TextField
          value={senderInput}
          onChange={(e) => setSenderInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addSender();
            }
          }}
          size="small"
          fullWidth
          placeholder="accounts@supplier.com or @supplier.com"
        />
        <Button variant="outlined" startIcon={<AddIcon />} onClick={addSender} disabled={!senderInput.trim()}>
          Add
        </Button>
      </Stack>

      {/* ③ Routing */}
      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
        ③ Document routing
      </Typography>
      <RadioGroup
        value={config.routingMode}
        onChange={(e) => patch({ routingMode: e.target.value === "FIXED" ? "FIXED" : "AI" })}
        sx={{ mb: 1 }}
      >
        <FormControlLabel value="AI" control={<Radio />} label="Let AI decide Bill vs Invoice per document (recommended)" />
        <FormControlLabel value="FIXED" control={<Radio />} label="Always create the same type" />
      </RadioGroup>
      {config.routingMode === "FIXED" && (
        <FormControl size="small" sx={{ mb: 2, minWidth: 220 }}>
          <InputLabel>Document type</InputLabel>
          <Select
            value={config.defaultDocType || "BILL"}
            label="Document type"
            onChange={(e) => patch({ defaultDocType: e.target.value === "INVOICE" ? "INVOICE" : "BILL" })}
          >
            <MenuItem value="BILL">Bill (AP)</MenuItem>
            <MenuItem value="INVOICE">Invoice (AR)</MenuItem>
          </Select>
        </FormControl>
      )}

      {/* ④ Hard rules */}
      <Typography variant="subtitle1" sx={{ fontWeight: 600, mt: 2 }}>
        ④ Rules
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Checked on every incoming email before the AI runs — top to bottom, first match wins. Use them for hard
        guarantees like &quot;ignore statements&quot; or &quot;everything from this domain is a bill&quot;.
      </Typography>
      <Stack spacing={2} sx={{ mb: 1 }}>
        {config.rules.map((rule, i) => (
          <Box key={i} sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5 }}>
            {rule.conditions.map((cond, j) => (
              <Stack key={j} direction="row" spacing={1} alignItems="center" sx={{ flexWrap: "wrap", gap: 1, mb: 1 }}>
                <Typography variant="body2" color="text.secondary" sx={{ width: 48 }}>
                  {j === 0 ? "WHEN" : "AND"}
                </Typography>
                <FormControl size="small" sx={{ minWidth: 130 }}>
                  <Select
                    value={cond.field}
                    onChange={(e) => updateCondition(i, j, { field: e.target.value as RuleCondition["field"] })}
                  >
                    {RULE_FIELDS.map((f) => (
                      <MenuItem key={f.value} value={f.value}>
                        {f.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl size="small" sx={{ minWidth: 130 }}>
                  <Select
                    value={cond.operator}
                    onChange={(e) => updateCondition(i, j, { operator: e.target.value as RuleCondition["operator"] })}
                  >
                    {RULE_OPERATORS.filter((o) => !o.senderOnly || cond.field === "SENDER").map((o) => (
                      <MenuItem key={o.value} value={o.value}>
                        {o.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <TextField
                  size="small"
                  value={cond.value}
                  onChange={(e) => updateCondition(i, j, { value: e.target.value })}
                  placeholder={cond.operator === "DOMAIN" ? "@supplier.com" : "statement of account"}
                  sx={{ minWidth: 220, flex: 1, maxWidth: 340 }}
                />
                {rule.conditions.length > 1 && (
                  <Tooltip title="Remove condition">
                    <IconButton
                      size="small"
                      onClick={() => updateRule(i, { conditions: rule.conditions.filter((_, k) => k !== j) })}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
              </Stack>
            ))}
            <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: "wrap", gap: 1 }}>
              <Button
                size="small"
                startIcon={<AddIcon />}
                onClick={() => updateRule(i, { conditions: [...rule.conditions, { ...EMPTY_CONDITION }] })}
                sx={{ width: 88, justifyContent: "flex-start" }}
              >
                And
              </Button>
              <Typography variant="body2" color="text.secondary">
                THEN
              </Typography>
              <FormControl size="small" sx={{ minWidth: 250 }}>
                <Select
                  value={rule.action}
                  onChange={(e) => updateRule(i, { action: e.target.value as IngestRule["action"] })}
                >
                  {RULE_ACTIONS.map((a) => (
                    <MenuItem key={a.value} value={a.value}>
                      {a.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Tooltip title="Remove rule">
                <IconButton size="small" onClick={() => patch({ rules: config.rules.filter((_, j) => j !== i) })}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
            {rule.action === "AI_GUIDANCE" && (
              <TextField
                value={rule.guidance}
                onChange={(e) => updateRule(i, { guidance: e.target.value })}
                multiline
                minRows={2}
                fullWidth
                size="small"
                placeholder='Instructions for the AI when this rule matches — e.g. "This email carries both our invoice and the supplier&apos;s bill; classify each attachment separately."'
                inputProps={{ maxLength: 1000 }}
                helperText={`AI instructions for this rule — the AI still classifies each attachment, guided by this. ${rule.guidance.length}/1000`}
                sx={{ mt: 1.5 }}
              />
            )}
          </Box>
        ))}
      </Stack>
      <Button
        variant="outlined"
        size="small"
        startIcon={<AddIcon />}
        onClick={() => patch({ rules: [...config.rules, { ...EMPTY_RULE }] })}
        sx={{ mb: 3 }}
      >
        Add rule
      </Button>

      {/* ⑤ AI guidance */}
      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
        ⑤ AI guidance
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Plain-English instructions sent to the AI classifier for anything subtler than the rules above (used only when
        routing is set to AI). Example: <em>&quot;Treat progress claims as invoices. Skip anything from our own staff.&quot;</em>
      </Typography>
      <TextField
        value={config.aiGuidance}
        onChange={(e) => patch({ aiGuidance: e.target.value })}
        multiline
        minRows={3}
        fullWidth
        disabled={config.routingMode === "FIXED"}
        placeholder="Extra instructions for the AI when it classifies incoming documents…"
        inputProps={{ maxLength: 2000 }}
        helperText={config.routingMode === "FIXED" ? "Not used while routing is fixed to one type." : `${config.aiGuidance.length}/2000`}
        sx={{ maxWidth: 720, mb: 3 }}
      />

      <Box sx={{ mb: 4 }}>
        <Button variant="contained" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </Box>

      {/* Client setup instructions */}
      <Accordion disableGutters sx={{ mb: 4 }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="subtitle2">How the client sets up forwarding (Gmail / Outlook / Yahoo)</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Typography variant="body2" sx={{ mb: 1 }}>
            Forward supplier emails to: <strong>{address || "(address not configured)"}</strong>
          </Typography>
          <Typography variant="body2" component="div" color="text.secondary">
            <strong>Gmail:</strong> Settings → See all settings → Forwarding and POP/IMAP → Add a forwarding address →
            paste the address. Gmail sends a verification email (it appears below as an IGNORED entry — open it and click
            the verify link). Then create a Filter: From = your suppliers → Forward it to the address.
            <br />
            <strong>Outlook:</strong> Settings → Mail → Rules → Add new rule → condition From = supplier → action Forward
            to the address.
            <br />
            <strong>Yahoo:</strong> Settings → More Settings → Filters → Add → From contains supplier → Forward to the
            address (Yahoo Plus may be required for auto-forwarding).
          </Typography>
        </AccordionDetails>
      </Accordion>

      {/* Recent activity */}
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          Recent activity
        </Typography>
        <Button size="small" startIcon={<RefreshIcon />} onClick={fetchLogs} disabled={logsLoading}>
          Refresh
        </Button>
      </Box>
      <TableContainer sx={{ border: 1, borderColor: "divider", borderRadius: 1 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Time</TableCell>
              <TableCell>From</TableCell>
              <TableCell>Subject</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Docs</TableCell>
              <TableCell>Details</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {logs.length === 0 && (
              <TableRow>
                <TableCell colSpan={6}>
                  <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: "center" }}>
                    {logsLoading ? "Loading…" : "No emails received yet."}
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {logs.map((log) => {
              const docIds = Array.isArray(log.createdDocumentIds) ? log.createdDocumentIds : [];
              return (
                <TableRow key={log.id} hover>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{new Date(log.createdAt).toLocaleString()}</TableCell>
                  <TableCell>{log.fromAddress || "—"}</TableCell>
                  <TableCell sx={{ maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {log.subject || "—"}
                  </TableCell>
                  <TableCell>
                    <Chip size="small" label={log.status} color={STATUS_CHIP_COLOR[log.status] || "default"} />
                  </TableCell>
                  <TableCell>
                    {docIds.length > 0
                      ? docIds.map((entry, i) => (
                          <Link
                            key={typeof entry === "string" ? entry : entry.id}
                            href={docHref(entry)}
                            underline="hover"
                            sx={{ mr: 1 }}
                          >
                            {docLabel(entry, i)}
                          </Link>
                        ))
                      : "—"}
                  </TableCell>
                  <TableCell sx={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <Tooltip title={log.reason || ""}>
                      <span>{log.reason || "—"}</span>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
