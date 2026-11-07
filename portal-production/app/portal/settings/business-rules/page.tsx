"use client";

// Settings → Business rules (guru 2026-10-24): the org's own management edits
// the numbers that used to be hardcoded — the progressive payment ladder,
// engagement fee, commission / rebate / design-fee defaults. Directors only
// (server-enforced). Rules SEED new projects/quotes; existing records keep
// their values.

import React, { useCallback, useEffect, useState } from "react";
import {
  Alert, Box, Button, Chip, CircularProgress, Divider, IconButton, MenuItem,
  Stack, TextField, Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import { useAuth } from "@clerk/nextjs";
import { toast } from "react-toastify";
import { request } from "@/helpers/request";

type Milestone = { label: string; pct: number | string; dueTrigger?: string | null };
type Rules = {
  payments: { milestones: Milestone[]; engagementFee: number | string; firstPaymentAltPct: number | string };
  commissionPct: number | string;
  rebatePct: number | string;
  designFeePct: number | string;
  quote: { paymentTerms: string[]; clauses: string[]; marginGuidelinePct: number | string; marginFloorPct: number | string };
  leads: { firstContactHours: number | string; replacementDays: number | string; nudgeEveryHours: number | string; nudgeCap: number | string; nudgeHourStart: number | string; nudgeHourEnd: number | string };
  booking: { slotMinutes: number | string; hourStart: number | string; hourEnd: number | string; daysAhead: number | string };
};

const TRIGGERS = [
  { value: "confirmation", label: "On confirmation" },
  { value: "commencement", label: "On commencement" },
  { value: "carpentry", label: "On carpentry" },
  { value: "handover", label: "On handover" },
  { value: "", label: "No trigger" },
];

export default function BusinessRulesPage() {
  const { getToken } = useAuth();
  const [rules, setRules] = useState<Rules | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      const res = await request({ path: "/org-rules", method: "GET" }, undefined, token ?? undefined);
      setRules(res?.data?.rules || res?.rules);
    } catch (e: any) {
      setError(e?.response?.data?.message || e.message || "Only Directors can open this page");
    }
  }, [getToken]);
  useEffect(() => {
    load();
  }, [load]);

  const set = (patch: Partial<Rules>) => {
    setRules((r) => (r ? { ...r, ...patch } : r));
    setDirty(true);
  };
  const setPay = (patch: Partial<Rules["payments"]>) => set({ payments: { ...rules!.payments, ...patch } });
  const setQuote = (patch: Partial<Rules["quote"]>) => set({ quote: { ...rules!.quote, ...patch } });
  const setLeads = (patch: Partial<Rules["leads"]>) => set({ leads: { ...rules!.leads, ...patch } });
  const setBooking = (patch: Partial<Rules["booking"]>) => set({ booking: { ...rules!.booking, ...patch } });
  const numField = (label: string, value: any, onChange: (v: string) => void, width = 170, helper?: string) => (
    <TextField
      size="small"
      label={label}
      value={value}
      onChange={(e) => /^[0-9]*\.?[0-9]*$/.test(e.target.value) && onChange(e.target.value)}
      inputProps={{ inputMode: "decimal" }}
      sx={{ width }}
      helperText={helper}
    />
  );

  const pctSum = rules ? rules.payments.milestones.reduce((s, m) => s + (Number(m.pct) || 0), 0) : 0;

  const save = async () => {
    if (!rules) return;
    if (Math.round(pctSum) !== 100) return toast.error(`Milestone percentages must add up to 100% (currently ${pctSum}%)`);
    setSaving(true);
    try {
      const token = await getToken();
      const body = {
        payments: {
          milestones: rules.payments.milestones.map((m, i) => ({ label: String(m.label).trim(), pct: Number(m.pct) || 0, dueTrigger: m.dueTrigger || (i === 0 ? "confirmation" : null) })),
          engagementFee: Number(rules.payments.engagementFee) || 0,
          firstPaymentAltPct: Number(rules.payments.firstPaymentAltPct) || 10,
        },
        commissionPct: Number(rules.commissionPct) || 50,
        rebatePct: Number(rules.rebatePct),
        designFeePct: Number(rules.designFeePct),
        quote: {
          paymentTerms: rules.quote.paymentTerms.map((t) => String(t)).filter((t) => t.trim()),
          clauses: rules.quote.clauses.map((t) => String(t)).filter((t) => t.trim()),
          marginGuidelinePct: Number(rules.quote.marginGuidelinePct) || 25,
          marginFloorPct: Number(rules.quote.marginFloorPct) || 0,
        },
        leads: {
          firstContactHours: Number(rules.leads.firstContactHours) || 24,
          replacementDays: Number(rules.leads.replacementDays) || 14,
          nudgeEveryHours: Number(rules.leads.nudgeEveryHours) || 3,
          nudgeCap: Number(rules.leads.nudgeCap) || 0,
          nudgeHourStart: Number(rules.leads.nudgeHourStart) || 0,
          nudgeHourEnd: Number(rules.leads.nudgeHourEnd) || 24,
        },
        booking: {
          slotMinutes: Number(rules.booking.slotMinutes) || 60,
          hourStart: Number(rules.booking.hourStart) || 0,
          hourEnd: Number(rules.booking.hourEnd) || 24,
          daysAhead: Number(rules.booking.daysAhead) || 14,
        },
      };
      await request({ path: "/org-rules", method: "PATCH" }, body, token ?? undefined);
      setDirty(false);
      toast.success("Business rules saved — they apply to newly created projects and quotations");
    } catch (e: any) {
      toast.error(e?.response?.data?.message || e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (error)
    return (
      <Box sx={{ p: { xs: 2, md: 8 } }}>
        <Alert severity="warning">{error}</Alert>
      </Box>
    );
  if (!rules)
    return (
      <Box sx={{ display: "flex", justifyContent: "center", pt: 10 }}>
        <CircularProgress />
      </Box>
    );

  return (
    <Box sx={{ p: { xs: 2, md: 8 }, maxWidth: 980 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
        <Typography variant="h4" sx={{ fontWeight: "bold", color: "primary.main" }}>
          Business rules
        </Typography>
        <Chip size="small" color="warning" variant="outlined" label="Directors only" sx={{ height: 20 }} />
      </Stack>
      <Typography variant="subtitle1" sx={{ color: "text.secondary", mb: 3 }}>
        Company defaults for money and payments. Changes apply to projects and quotations created from now on — existing ones keep their numbers.
      </Typography>

      {/* ── Progressive payment schedule ─────────────────────────────── */}
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
        Progressive payment schedule
      </Typography>
      <Typography variant="body2" sx={{ color: "text.secondary", mb: 1.5 }}>
        The milestone ladder seeded onto every new project. Percentages must total 100%.
      </Typography>
      <Stack spacing={1} sx={{ mb: 1 }}>
        {rules.payments.milestones.map((m, i) => (
          <Stack key={i} direction="row" spacing={1} alignItems="center">
            <Typography variant="body2" sx={{ width: 18, textAlign: "right", color: "text.secondary" }}>{i + 1}</Typography>
            <TextField
              size="small"
              fullWidth
              label="Milestone label"
              value={m.label}
              onChange={(e) => setPay({ milestones: rules.payments.milestones.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })}
            />
            <TextField
              size="small"
              label="%"
              value={m.pct}
              onChange={(e) => /^[0-9]*\.?[0-9]*$/.test(e.target.value) && setPay({ milestones: rules.payments.milestones.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)) })}
              inputProps={{ inputMode: "decimal", style: { textAlign: "right" } }}
              sx={{ width: 90 }}
            />
            <TextField
              size="small"
              select
              label="Due"
              value={m.dueTrigger || ""}
              onChange={(e) => setPay({ milestones: rules.payments.milestones.map((x, j) => (j === i ? { ...x, dueTrigger: e.target.value || null } : x)) })}
              sx={{ width: 180 }}
            >
              {TRIGGERS.map((t) => (
                <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>
              ))}
            </TextField>
            <IconButton
              size="small"
              disabled={rules.payments.milestones.length <= 1}
              onClick={() => setPay({ milestones: rules.payments.milestones.filter((_, j) => j !== i) })}
              sx={{ color: "text.disabled", "&:hover": { color: "error.main" } }}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Stack>
        ))}
      </Stack>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 3 }}>
        <Button size="small" startIcon={<AddIcon />} onClick={() => setPay({ milestones: [...rules.payments.milestones, { label: "", pct: 0, dueTrigger: null }] })} sx={{ textTransform: "none" }}>
          Add milestone
        </Button>
        <Chip size="small" color={Math.round(pctSum) === 100 ? "success" : "error"} variant="outlined" label={`Total ${pctSum}%`} />
      </Stack>

      {/* ── First payment chooser ────────────────────────────────────── */}
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
        First payment on confirmation
      </Typography>
      <Typography variant="body2" sx={{ color: "text.secondary", mb: 1.5 }}>
        The either/or on each project's Payments tab: a fixed engagement fee OR a percentage of the contract sum.
      </Typography>
      <Stack direction="row" spacing={2} sx={{ mb: 3 }}>
        <TextField
          size="small"
          label="Engagement fee (S$)"
          value={rules.payments.engagementFee}
          onChange={(e) => /^[0-9]*\.?[0-9]*$/.test(e.target.value) && setPay({ engagementFee: e.target.value })}
          inputProps={{ inputMode: "decimal" }}
          sx={{ width: 200 }}
        />
        <TextField
          size="small"
          label="…or % of contract"
          value={rules.payments.firstPaymentAltPct}
          onChange={(e) => /^[0-9]*\.?[0-9]*$/.test(e.target.value) && setPay({ firstPaymentAltPct: e.target.value })}
          inputProps={{ inputMode: "decimal" }}
          sx={{ width: 160 }}
        />
      </Stack>

      <Divider sx={{ mb: 3 }} />

      {/* ── Default percentages ──────────────────────────────────────── */}
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
        Default percentages
      </Typography>
      <Typography variant="body2" sx={{ color: "text.secondary", mb: 1.5 }}>
        Used when a project, designer profile or supplier has no specific value of its own.
      </Typography>
      <Stack direction="row" spacing={2} sx={{ mb: 4, flexWrap: "wrap", rowGap: 2 }}>
        <TextField
          size="small"
          label="Sales commission %"
          value={rules.commissionPct}
          onChange={(e) => /^[0-9]*\.?[0-9]*$/.test(e.target.value) && set({ commissionPct: e.target.value })}
          inputProps={{ inputMode: "decimal" }}
          sx={{ width: 180 }}
          helperText="Designer commission on project profit"
        />
        <TextField
          size="small"
          label="Supplier rebate %"
          value={rules.rebatePct}
          onChange={(e) => /^[0-9]*\.?[0-9]*$/.test(e.target.value) && set({ rebatePct: e.target.value })}
          inputProps={{ inputMode: "decimal" }}
          sx={{ width: 180 }}
          helperText="Per-supplier/project overrides still win"
        />
        <TextField
          size="small"
          label="Design fee %"
          value={rules.designFeePct}
          onChange={(e) => /^[0-9]*\.?[0-9]*$/.test(e.target.value) && set({ designFeePct: e.target.value })}
          inputProps={{ inputMode: "decimal" }}
          sx={{ width: 180 }}
          helperText="Default on new quotations"
        />
      </Stack>

      <Divider sx={{ mb: 3 }} />

      {/* ── Quotation defaults ───────────────────────────────────────── */}
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
        Quotation defaults
      </Typography>
      <Typography variant="body2" sx={{ color: "text.secondary", mb: 1.5 }}>
        The payment-terms lines and Terms &amp; Conditions seeded onto every NEW quotation. Existing quotations are untouched; each quote stays editable in its Terms dialog.
      </Typography>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>Payment terms (one line each)</Typography>
      <Stack spacing={0.75} sx={{ mb: 1 }}>
        {rules.quote.paymentTerms.map((t, i) => (
          <Stack key={i} direction="row" spacing={1} alignItems="center">
            <TextField size="small" fullWidth value={t} onChange={(e) => setQuote({ paymentTerms: rules.quote.paymentTerms.map((x, j) => (j === i ? e.target.value : x)) })} />
            <IconButton size="small" disabled={rules.quote.paymentTerms.length <= 1} onClick={() => setQuote({ paymentTerms: rules.quote.paymentTerms.filter((_, j) => j !== i) })} sx={{ color: "text.disabled", "&:hover": { color: "error.main" } }}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Stack>
        ))}
      </Stack>
      <Button size="small" startIcon={<AddIcon />} onClick={() => setQuote({ paymentTerms: [...rules.quote.paymentTerms, ""] })} sx={{ textTransform: "none", mb: 2 }}>
        Add line
      </Button>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>Terms &amp; Conditions clauses</Typography>
      <Stack spacing={0.75} sx={{ mb: 1 }}>
        {rules.quote.clauses.map((t, i) => (
          <Stack key={i} direction="row" spacing={1} alignItems="flex-start">
            <Typography variant="body2" sx={{ width: 20, textAlign: "right", pt: 1, color: "text.secondary" }}>{i + 1}</Typography>
            <TextField size="small" fullWidth multiline minRows={1} value={t} onChange={(e) => setQuote({ clauses: rules.quote.clauses.map((x, j) => (j === i ? e.target.value : x)) })} InputProps={{ sx: { fontSize: 13 } }} />
            <IconButton size="small" disabled={rules.quote.clauses.length <= 1} onClick={() => setQuote({ clauses: rules.quote.clauses.filter((_, j) => j !== i) })} sx={{ color: "text.disabled", "&:hover": { color: "error.main" }, mt: 0.5 }}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Stack>
        ))}
      </Stack>
      <Button size="small" startIcon={<AddIcon />} onClick={() => setQuote({ clauses: [...rules.quote.clauses, ""] })} sx={{ textTransform: "none", mb: 2 }}>
        Add clause
      </Button>
      <Stack direction="row" spacing={2} sx={{ mb: 4, flexWrap: "wrap", rowGap: 2 }}>
        {numField("Margin guideline %", rules.quote.marginGuidelinePct, (v) => setQuote({ marginGuidelinePct: v }), 180, "Editor aims here")}
        {numField("Margin floor %", rules.quote.marginFloorPct, (v) => setQuote({ marginFloorPct: v }), 180, "Editor warns below this")}
      </Stack>

      <Divider sx={{ mb: 3 }} />

      {/* ── Leads & follow-up ────────────────────────────────────────── */}
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
        Leads &amp; follow-up
      </Typography>
      <Typography variant="body2" sx={{ color: "text.secondary", mb: 1.5 }}>
        Contact windows for provider leads and the WhatsApp reply-nudge cadence.
      </Typography>
      <Stack direction="row" spacing={2} sx={{ mb: 4, flexWrap: "wrap", rowGap: 2 }}>
        {numField("First contact within (hours)", rules.leads.firstContactHours, (v) => setLeads({ firstContactHours: v }), 200)}
        {numField("Replacement window (days)", rules.leads.replacementDays, (v) => setLeads({ replacementDays: v }), 200)}
        {numField("Nudge every (hours)", rules.leads.nudgeEveryHours, (v) => setLeads({ nudgeEveryHours: v }), 170)}
        {numField("Max nudges per lead", rules.leads.nudgeCap, (v) => setLeads({ nudgeCap: v }), 170)}
        {numField("Nudges from (hour)", rules.leads.nudgeHourStart, (v) => setLeads({ nudgeHourStart: v }), 160, "24h clock, SGT")}
        {numField("until (hour)", rules.leads.nudgeHourEnd, (v) => setLeads({ nudgeHourEnd: v }), 140, "24h clock, SGT")}
      </Stack>

      <Divider sx={{ mb: 3 }} />

      {/* ── Appointment booking ──────────────────────────────────────── */}
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
        Appointment booking
      </Typography>
      <Typography variant="body2" sx={{ color: "text.secondary", mb: 1.5 }}>
        Defaults for NEWLY minted public booking links. Existing links keep their settings.
      </Typography>
      <Stack direction="row" spacing={2} sx={{ mb: 4, flexWrap: "wrap", rowGap: 2 }}>
        {numField("Slot length (minutes)", rules.booking.slotMinutes, (v) => setBooking({ slotMinutes: v }), 180)}
        {numField("Bookable from (hour)", rules.booking.hourStart, (v) => setBooking({ hourStart: v }), 170, "24h clock, SGT")}
        {numField("until (hour)", rules.booking.hourEnd, (v) => setBooking({ hourEnd: v }), 140, "24h clock, SGT")}
        {numField("Days ahead", rules.booking.daysAhead, (v) => setBooking({ daysAhead: v }), 140)}
      </Stack>

      <Button variant="contained" disabled={saving || !dirty} onClick={save} sx={{ textTransform: "none" }} data-tour="business-rules-save">
        {saving ? "Saving…" : "Save business rules"}
      </Button>
    </Box>
  );
}
