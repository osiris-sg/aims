"use client";

// Sticky totals: Total → Professional Design Fee → named discounts → Grand
// Total. Internal view adds total cost, margin and the guardrail status.

import React, { useState } from "react";
import { Alert, Box, Button, Divider, IconButton, InputAdornment, Paper, Stack, TextField, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import GavelIcon from "@mui/icons-material/GavelOutlined";
import type { IdQuote } from "../_lib/types";
import { money, newId, pct, quoteTotals } from "../_lib/math";

interface Props {
  quote: IdQuote;
  internalView: boolean;
  readOnly: boolean;
  onChange: (next: IdQuote) => void;
  onEditTerms: () => void;
  onJumpToItem: (itemId: string) => void;
}

const Row = ({ label, value, strong, muted }: { label: React.ReactNode; value: React.ReactNode; strong?: boolean; muted?: boolean }) => (
  <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ py: 0.5 }}>
    <Typography variant={strong ? "subtitle1" : "body2"} sx={{ fontWeight: strong ? 800 : 400, color: muted ? "text.secondary" : "text.primary" }}>
      {label}
    </Typography>
    <Typography variant={strong ? "subtitle1" : "body2"} sx={{ fontWeight: strong ? 800 : 500, fontVariantNumeric: "tabular-nums", color: muted ? "text.secondary" : "text.primary" }}>
      {value}
    </Typography>
  </Stack>
);

/** Numeric field that lets the user TYPE freely (decimals included): keeps a
 *  local string draft while focused and commits the parsed number live, so
 *  "73." doesn't collapse to "73" mid-keystroke. */
function DecimalField({ value, onCommit, disabled, width, startAdornment, endAdornment }: { value: number; onCommit: (n: number) => void; disabled?: boolean; width: number; startAdornment?: React.ReactNode; endAdornment?: React.ReactNode }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <TextField
      size="small"
      value={draft ?? (value || "")}
      disabled={disabled}
      onFocus={() => setDraft(value ? String(value) : "")}
      onChange={(e) => {
        const v = e.target.value;
        if (!/^[0-9]*\.?[0-9]*$/.test(v)) return;
        setDraft(v);
        onCommit(v === "" ? 0 : Math.max(0, Number(v) || 0));
      }}
      onBlur={() => setDraft(null)}
      inputProps={{ inputMode: "decimal", style: { textAlign: "right", width, padding: "4px 6px" } }}
      InputProps={{ ...(startAdornment ? { startAdornment } : {}), ...(endAdornment ? { endAdornment } : {}) }}
    />
  );
}

export default function SummaryPanel({ quote, internalView, readOnly, onChange, onEditTerms, onJumpToItem }: Props) {
  const t = quoteTotals(quote);
  const floor = quote.settings.marginFloorPct;

  const setDiscount = (id: string, patch: Partial<{ label: string; amount: number }>) =>
    onChange({ ...quote, summary: { ...quote.summary, discounts: quote.summary.discounts.map((d) => (d.id === id ? { ...d, ...patch } : d)) } });

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, p: 2, position: { xl: "sticky" }, top: { xl: 72 }, minWidth: 0 }}>
      <Typography variant="overline" sx={{ color: "text.secondary" }}>
        Summary
      </Typography>
      <Row label="Total Amount" value={money(t.total)} />
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ py: 0.5 }}>
        <Stack direction="row" spacing={0.75} alignItems="center">
          <Typography variant="body2">Professional Design Fee</Typography>
          <DecimalField value={quote.summary.designFeePct} onCommit={(n) => onChange({ ...quote, summary: { ...quote.summary, designFeePct: n } })} disabled={readOnly} width={34} endAdornment={<InputAdornment position="end">%</InputAdornment>} />
        </Stack>
        <Typography variant="body2" sx={{ fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>
          {money(t.designFee)}
        </Typography>
      </Stack>
      {quote.summary.discounts.map((d) => (
        <Stack key={d.id} direction="row" spacing={0.75} alignItems="center" sx={{ py: 0.5 }}>
          <TextField size="small" fullWidth placeholder="Discount label" value={d.label} disabled={readOnly} onChange={(e) => setDiscount(d.id, { label: e.target.value })} inputProps={{ style: { padding: "4px 8px", fontSize: 13 } }} />
          <DecimalField value={d.amount} onCommit={(n) => setDiscount(d.id, { amount: n })} disabled={readOnly} width={78} startAdornment={<InputAdornment position="start">−$</InputAdornment>} />
          {!readOnly && (
            <IconButton size="small" onClick={() => onChange({ ...quote, summary: { ...quote.summary, discounts: quote.summary.discounts.filter((x) => x.id !== d.id) } })} sx={{ color: "text.disabled" }}>
              <DeleteIcon sx={{ fontSize: 16 }} />
            </IconButton>
          )}
        </Stack>
      ))}
      {!readOnly && (
        <Button size="small" startIcon={<AddIcon />} sx={{ textTransform: "none", color: "text.secondary" }} onClick={() => onChange({ ...quote, summary: { ...quote.summary, discounts: [...quote.summary.discounts, { id: newId(), label: "Complimentary Discount", amount: 0 }] } })}>
          Add discount
        </Button>
      )}
      <Divider sx={{ my: 1 }} />
      <Row label="Grand Total" value={`S$ ${money(t.grand)}`} strong />

      {internalView && (
        <Box sx={{ mt: 1.5, pt: 1.5, borderTop: 1, borderColor: "divider" }}>
          <Typography variant="overline" sx={{ color: "text.secondary" }}>
            Internal
          </Typography>
          <Row label="Total cost" value={money(t.totalCost)} muted />
          <Row label="Margin" value={t.anyCost ? `${money(t.grand - t.totalCost)} · ${pct(t.marginPct)}` : "no costs yet"} muted={!t.anyCost} />
          <Typography variant="caption" sx={{ color: "text.disabled", display: "block", mb: 1 }}>
            Guideline {quote.settings.marginGuidelinePct}% · floor {floor}% (margin on price)
          </Typography>
          {t.breach ? (
            <Alert severity="warning" variant="outlined" sx={{ "& .MuiAlert-message": { width: "100%" } }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                Below the {floor}% floor — management will be notified on save.
              </Typography>
              {t.lowLines.slice(0, 6).map((l) => (
                <Typography key={l.itemId} variant="caption" component="div" sx={{ cursor: "pointer", "&:hover": { textDecoration: "underline" } }} onClick={() => onJumpToItem(l.itemId)}>
                  {l.sectionLetter}{l.no} · {pct(l.marginPct)} · {l.description.slice(0, 48)}
                  {l.description.length > 48 ? "…" : ""}
                </Typography>
              ))}
              {t.lowLines.length > 6 && (
                <Typography variant="caption" sx={{ color: "text.secondary" }}>
                  +{t.lowLines.length - 6} more
                </Typography>
              )}
            </Alert>
          ) : t.anyCost ? (
            <Alert severity="success" variant="outlined">
              Margins within guideline.
            </Alert>
          ) : null}
        </Box>
      )}

      <Button fullWidth size="small" variant="text" startIcon={<GavelIcon />} onClick={onEditTerms} sx={{ mt: 1.5, textTransform: "none" }}>
        Payment terms & T&Cs
      </Button>
    </Paper>
  );
}
