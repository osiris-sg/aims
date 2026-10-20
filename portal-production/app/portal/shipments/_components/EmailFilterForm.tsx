/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Sender filter (round K): which mail the intake keeps. Off / Trial run (SHADOW:
// decide + log "would drop", keep everything — see Shipments › Inbox › Filter
// preview) / Enforce (drop before anything is stored). An email is kept when a
// participant is an allowed domain / address (the org's own addresses alone
// don't count), its subject or an attachment name has a shipment key (B/L,
// contract, PI, CI no.), or it replies on a thread already matched to an order.

import React, { useEffect, useState } from "react";
import { Alert, Box, Button, Chip, FormControlLabel, Radio, RadioGroup, Stack, TextField, Typography } from "@mui/material";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useShipmentsApi, type EmailFilterMode } from "../_lib/api";
import { toast } from "../_lib/toast";

const MODES: Array<{ value: EmailFilterMode; label: string; hint: string }> = [
  { value: "OFF", label: "Off", hint: "every email is kept and triaged" },
  { value: "SHADOW", label: "Trial run", hint: "every email is still kept; Inbox › Filter preview shows what would be dropped" },
  { value: "ENFORCE", label: "Enforce", hint: "mail that fails the filter is dropped before it is stored (only a minimal log line is kept)" },
];

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

export default function EmailFilterForm() {
  const api = useShipmentsApi();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["trade-email-filter"], queryFn: () => api.getEmailFilter() });
  const [mode, setMode] = useState<EmailFilterMode>("OFF");
  const [domains, setDomains] = useState("");
  const [addresses, setAddresses] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!q.data) return;
    setMode(q.data.filterMode);
    setDomains(q.data.allowDomains.join("\n"));
    setAddresses(q.data.allowAddresses.join("\n"));
    setNotes(notesToText(q.data.filterNotes));
  }, [q.data]);
  if (q.isError) return <Alert severity="error">{(q.error as Error)?.message || "Could not load the email filter"}</Alert>;
  const noteOf = q.data?.filterNotes ?? {};
  const pending = Object.entries(noteOf).filter(([k]) => !k.includes("."));
  const save = async () => {
    if (mode === "ENFORCE" && q.data?.filterMode !== "ENFORCE" && !lines(domains).length && !lines(addresses).length) {
      toast.error("Add at least one allowed domain or address before enforcing");
      return;
    }
    setSaving(true);
    try {
      await api.updateEmailFilter({ filterMode: mode, allowDomains: lines(domains), allowAddresses: lines(addresses), filterNotes: textToNotes(notes) });
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
      <Stack direction="row" justifyContent="flex-end">
        <Button variant="contained" onClick={save} disabled={saving || q.isLoading}>
          Save
        </Button>
      </Stack>
    </Stack>
  );
}
