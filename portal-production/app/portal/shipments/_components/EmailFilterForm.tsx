/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Sender filter (round K): which mail the intake keeps. Off / Trial run (SHADOW:
// decide + log "would drop", keep everything — see Shipments › Inbox › Filter
// preview) / Enforce (drop before anything is stored). An email is kept when a
// participant is an allowed domain / address (the org's own addresses alone
// don't count), its subject or an attachment name has a shipment key (B/L,
// contract, PI, CI no.), or it replies on a thread already matched to an order.
//
// Companies (round W, C.4): the Inbox "Company" chip shows the company behind
// the sender's domain (isewan.co.jp → "Isewan"). Built-ins cover the known
// parties; the org's own list here adds or renames domains (saved with the form,
// stored as TradeSetting.docDefaults.emailCompanies). An unknown domain shows
// the domain itself.

import React, { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControlLabel,
  IconButton,
  Radio,
  RadioGroup,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useShipmentsApi, type EmailFilter, type EmailFilterMode } from "../_lib/api";
import { toast } from "../_lib/toast";

const MODES: Array<{ value: EmailFilterMode; label: string; hint: string }> = [
  { value: "OFF", label: "Off", hint: "every email is kept and triaged" },
  { value: "SHADOW", label: "Trial run", hint: "every email is still kept; Inbox › Filter preview shows what would be dropped" },
  { value: "ENFORCE", label: "Enforce", hint: "mail that fails the filter is dropped before it is stored (only a minimal log line is kept)" },
];

/** The filter payload with the round-W company list (typed here; `_lib/api.ts` keeps its own shape). */
type EmailFilterWithCompanies = EmailFilter & { emailCompanies?: Record<string, string>; companyDefaults?: Record<string, string> };
type CompanyRow = { domain: string; name: string };
const COMPANY_DOMAIN_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/;
const COMPANY_NAME_MAX = 60;
const COMPANY_LIST_MAX = 200;

const lines = (s: string) => s.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);
/** "domain — note" per line ↔ { domain: note }. */
const notesToText = (n: Record<string, string>) => Object.entries(n).map(([k, v]) => `${k} — ${v}`).join("\n");
const textToNotes = (s: string) =>
  Object.fromEntries(
    s
      .split("\n")
      // Split on a spaced " — " / " - " or ": " only — domains have hyphens (evergreen-line.com).
      .map((l) => /^\s*(\S.*?)(?:\s+[—-]\s+|:\s+)(.+?)\s*$/.exec(l))
      .filter((m): m is RegExpExecArray => !!m)
      .map((m) => [m[1], m[2]]),
  );
const rowsOf = (m: Record<string, string> | undefined) => Object.entries(m ?? {}).map(([domain, name]) => ({ domain, name }));

/** The rows as the API map, or the first problem as a message. */
function companiesOf(rows: CompanyRow[]): { map: Record<string, string> } | { error: string } {
  const map: Record<string, string> = {};
  for (const r of rows) {
    const domain = r.domain.trim().toLowerCase().replace(/^@/, "");
    const name = r.name.trim();
    if (!domain && !name) continue; // an empty row is just skipped
    if (!COMPANY_DOMAIN_RE.test(domain)) return { error: `"${r.domain.trim() || "(empty)"}" is not an email domain (like isewan.co.jp)` };
    if (!name || name.length > COMPANY_NAME_MAX) return { error: `The company name for ${domain} must be 1–${COMPANY_NAME_MAX} characters` };
    map[domain] = name;
  }
  if (Object.keys(map).length > COMPANY_LIST_MAX) return { error: `At most ${COMPANY_LIST_MAX} companies` };
  return { map };
}

export default function EmailFilterForm() {
  const api = useShipmentsApi();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["trade-email-filter"], queryFn: () => api.getEmailFilter() as Promise<EmailFilterWithCompanies> });
  const [mode, setMode] = useState<EmailFilterMode>("OFF");
  const [domains, setDomains] = useState("");
  const [addresses, setAddresses] = useState("");
  const [notes, setNotes] = useState("");
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!q.data) return;
    setMode(q.data.filterMode);
    setDomains(q.data.allowDomains.join("\n"));
    setAddresses(q.data.allowAddresses.join("\n"));
    setNotes(notesToText(q.data.filterNotes));
    setCompanies(rowsOf(q.data.emailCompanies));
  }, [q.data]);
  if (q.isError) return <Alert severity="error">{(q.error as Error)?.message || "Could not load the email filter"}</Alert>;
  const noteOf = q.data?.filterNotes ?? {};
  const pending = Object.entries(noteOf).filter(([k]) => !k.includes("."));
  const defaults = q.data?.companyDefaults ?? {};
  const overridden = new Set(companies.map((c) => c.domain.trim().toLowerCase()));
  const setRow = (i: number, patch: Partial<CompanyRow>) => setCompanies((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = (row: CompanyRow = { domain: "", name: "" }) => setCompanies((rows) => [...rows, row]);
  const removeRow = (i: number) => setCompanies((rows) => rows.filter((_, j) => j !== i));
  const save = async () => {
    if (mode === "ENFORCE" && q.data?.filterMode !== "ENFORCE" && !lines(domains).length && !lines(addresses).length) {
      toast.error("Add at least one allowed domain or address before enforcing");
      return;
    }
    const c = companiesOf(companies);
    if ("error" in c) {
      toast.error(c.error);
      return;
    }
    setSaving(true);
    try {
      const body: Partial<EmailFilterWithCompanies> = { filterMode: mode, allowDomains: lines(domains), allowAddresses: lines(addresses), filterNotes: textToNotes(notes), emailCompanies: c.map };
      await api.updateEmailFilter(body);
      await qc.invalidateQueries({ queryKey: ["trade-email-filter"] });
      toast.success("Email filter saved");
    } catch (e: any) {
      toast.error(e?.message || "Could not save");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Stack spacing={2} data-tour="settings-email-filter">
      <RadioGroup value={mode} onChange={(e) => setMode(e.target.value as EmailFilterMode)}>
        {MODES.map((m) => (
          <FormControlLabel
            key={m.value}
            value={m.value}
            control={<Radio size="small" />}
            label={
              <Typography variant="body2">
                <b>{m.label}</b> — {m.hint}
              </Typography>
            }
          />
        ))}
      </RadioGroup>
      <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
        <Box sx={{ flex: 1 }}>
          <TextField
            size="small"
            fullWidth
            multiline
            minRows={6}
            label="Allowed domains (one per line)"
            value={domains}
            disabled={q.isLoading}
            onChange={(e) => setDomains(e.target.value)}
            inputProps={{ style: { fontFamily: "monospace", fontSize: 12.5 } }}
            data-tour="settings-email-filter-domains"
          />
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.75 }}>
            {lines(domains)
              .filter((d) => noteOf[d])
              .map((d) => (
                <Chip key={d} size="small" variant="outlined" color={/unverified|not seen/.test(noteOf[d]) ? "warning" : "default"} label={`${d}: ${noteOf[d]}`} />
              ))}
          </Stack>
        </Box>
        <Box sx={{ flex: 1 }}>
          <TextField
            size="small"
            fullWidth
            multiline
            minRows={6}
            label="Allowed addresses (one per line)"
            value={addresses}
            disabled={q.isLoading}
            onChange={(e) => setAddresses(e.target.value)}
            placeholder="someone@gmail.com"
            inputProps={{ style: { fontFamily: "monospace", fontSize: 12.5 } }}
          />
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>
            For people writing from a personal mailbox (gmail.com etc.) — never allow a whole public domain.
          </Typography>
        </Box>
      </Stack>
      <TextField
        size="small"
        fullWidth
        multiline
        minRows={3}
        label="Notes (one per line: domain or party — note)"
        value={notes}
        disabled={q.isLoading}
        onChange={(e) => setNotes(e.target.value)}
        inputProps={{ style: { fontSize: 12.5 } }}
        helperText={pending.length ? `Still to add: ${pending.map(([k, v]) => `${k} (${v})`).join(", ")}` : undefined}
      />
      <Typography variant="caption" color="text.secondary">
        Always kept, whatever the list: a shipment key in the subject or an attachment name (B/L 198GX… / 22AA… / KMTC… / MEDU… / SITG… / GGVC…, contract 4540…, PI 9331…, CI XP26… / 9000…) and replies on a thread already matched to an order. Mail only between your own addresses is kept only then.
      </Typography>

      {/* Companies: sender domain → the name the Inbox "Company" chip shows. */}
      <Box data-tour="settings-email-companies">
        <Typography variant="subtitle2" sx={{ mb: 0.25 }}>
          Companies
        </Typography>
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
          The Inbox shows the company behind each sender&apos;s domain (isewan.co.jp → Isewan). Add a domain the built-ins don&apos;t know, or rename one; an unknown domain shows the domain itself. A subdomain follows its parent (mail.sus.co.jp → SUS).
        </Typography>
        {Object.keys(defaults).length > 0 && (
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
            {Object.entries(defaults).map(([d, n]) => (
              <Tooltip key={d} title={overridden.has(d) ? "Renamed in your list below" : "Built-in — click to rename it for your organisation"}>
                <Chip
                  size="small"
                  variant="outlined"
                  label={`${d} → ${n}`}
                  sx={{ opacity: overridden.has(d) ? 0.5 : 1, textDecoration: overridden.has(d) ? "line-through" : "none" }}
                  onClick={overridden.has(d) ? undefined : () => addRow({ domain: d, name: n })}
                />
              </Tooltip>
            ))}
          </Stack>
        )}
        <Table size="small" sx={{ "& td, & th": { px: 0.75, py: 0.5 } }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: "45%" }}>Sender domain</TableCell>
              <TableCell>Company</TableCell>
              <TableCell align="right" sx={{ width: 48 }} />
            </TableRow>
          </TableHead>
          <TableBody>
            {companies.map((row, i) => {
              const d = row.domain.trim().toLowerCase();
              const badDomain = !!d && !COMPANY_DOMAIN_RE.test(d);
              const badName = row.name.trim().length > COMPANY_NAME_MAX || (!!d && !row.name.trim());
              return (
                <TableRow key={i}>
                  <TableCell>
                    <TextField
                      size="small"
                      fullWidth
                      value={row.domain}
                      placeholder="isewan.co.jp"
                      error={badDomain}
                      disabled={q.isLoading}
                      onChange={(e) => setRow(i, { domain: e.target.value })}
                      inputProps={{ style: { fontFamily: "monospace", fontSize: 12.5 }, "aria-label": "Sender domain" }}
                    />
                  </TableCell>
                  <TableCell>
                    <TextField
                      size="small"
                      fullWidth
                      value={row.name}
                      placeholder="Isewan"
                      error={badName}
                      disabled={q.isLoading}
                      onChange={(e) => setRow(i, { name: e.target.value })}
                      inputProps={{ maxLength: COMPANY_NAME_MAX, style: { fontSize: 12.5 }, "aria-label": "Company name" }}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <IconButton size="small" aria-label="Remove" onClick={() => removeRow(i)} sx={{ color: "error.main" }}>
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              );
            })}
            {!companies.length && (
              <TableRow>
                <TableCell colSpan={3}>
                  <Typography variant="caption" color="text.secondary">
                    No companies of your own yet — the built-ins above apply.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        <Button size="small" startIcon={<AddIcon />} onClick={() => addRow()} disabled={q.isLoading || companies.length >= COMPANY_LIST_MAX} sx={{ mt: 0.5 }}>
          Add company
        </Button>
      </Box>

      <Stack direction="row" justifyContent="flex-end">
        <Button variant="contained" onClick={save} disabled={saving || q.isLoading}>
          Save
        </Button>
      </Stack>
    </Stack>
  );
}
