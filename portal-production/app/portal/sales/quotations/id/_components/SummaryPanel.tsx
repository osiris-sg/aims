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
  // py 0.25, not 0.5: the rail has to show Summary, every discount, Grand Total
  // AND the internal margin block without the user scrolling for them
  // (guru 2026-10-11). Each row saved here is a row that stays on screen.
  <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ py: 0.25 }}>
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
      // The discount row pairs this with a fullWidth label field — without a
      // shrink lock the flexbox squeezes this input and the digits clip
      // ("2320" renders as "232…", guru 2026-10-03).
      sx={{ flexShrink: 0 }}
    />
  );
}

export default function SummaryPanel({ quote, internalView, readOnly, onChange, onEditTerms, onJumpToItem }: Props) {
  const [showAllLow, setShowAllLow] = useState(false);
  const t = quoteTotals(quote);
  const floor = quote.settings.marginFloorPct;

  const setDiscount = (id: string, patch: Partial<{ label: string; amount: number }>) =>
    onChange({ ...quote, summary: { ...quote.summary, discounts: quote.summary.discounts.map((d) => (d.id === id ? { ...d, ...patch } : d)) } });

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, p: 1.5, position: { xl: "sticky" }, top: { xl: 72 }, minWidth: 0 }}>
      <Typography variant="overline" sx={{ color: "text.secondary", display: "block", lineHeight: 1.6 }}>
        Summary
      </Typography>
      <Row label="Total Amount" value={money(t.total)} />
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ py: 0.25 }}>
        <Stack direction="row" spacing={0.75} alignItems="center">
          <Typography variant="body2">Professional Design Fee</Typography>
          <DecimalField value={quote.summary.designFeePct} onCommit={(n) => onChange({ ...quote, summary: { ...quote.summary, designFeePct: n } })} disabled={readOnly} width={34} endAdornment={<InputAdornment position="end">%</InputAdornment>} />
        </Stack>
        <Typography variant="body2" sx={{ fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>
          {money(t.designFee)}
        </Typography>
      </Stack>
      {quote.summary.discounts.map((d) => (
        <Stack key={d.id} direction="row" spacing={0.5} alignItems="center" sx={{ py: 0.25 }}>
          {/* title= so the full name is still readable when the rail clips it. */}
          <TextField size="small" fullWidth placeholder="Discount label" value={d.label} disabled={readOnly} title={d.label} onChange={(e) => setDiscount(d.id, { label: e.target.value })} inputProps={{ style: { padding: "2px 6px", fontSize: 12 } }} />
          <DecimalField value={d.amount} onCommit={(n) => setDiscount(d.id, { amount: n })} disabled={readOnly} width={78} startAdornment={<InputAdornment position="start">−$</InputAdornment>} />
          {!readOnly && (
            <IconButton size="small" onClick={() => onChange({ ...quote, summary: { ...quote.summary, discounts: quote.summary.discounts.filter((x) => x.id !== d.id) } })} sx={{ color: "text.disabled", p: 0.25 }}>
              <DeleteIcon sx={{ fontSize: 15 }} />
            </IconButton>
          )}
        </Stack>
      ))}
      {!readOnly && (
        <Button size="small" startIcon={<AddIcon />} sx={{ textTransform: "none", color: "text.secondary", py: 0.25, minHeight: 0 }} onClick={() => onChange({ ...quote, summary: { ...quote.summary, discounts: [...quote.summary.discounts, { id: newId(), label: "Complimentary Discount", amount: 0 }] } })}>
          Add discount
        </Button>
      )}
      <Divider sx={{ my: 0.75 }} />
      <Row label="Grand Total" value={`S$ ${money(t.grand)}`} strong />

      {internalView && (
        <Box sx={{ mt: 1, pt: 1, borderTop: 1, borderColor: "divider" }}>
          <Typography variant="overline" sx={{ color: "text.secondary", display: "block", lineHeight: 1.6 }}>
            Internal
          </Typography>
          {/* Cost and margin sit SIDE BY SIDE rather than on two rows, and the
              guideline/floor note rides under the margin instead of taking a
              line of its own — the rail has to end above the fold
              (guru 2026-10-11). */}
          <Stack direction="row" spacing={1} alignItems="flex-start" sx={{ py: 0.25 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="caption" sx={{ color: "text.secondary", display: "block", lineHeight: 1.3 }}>
                Total cost
              </Typography>
              <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums", color: "text.secondary" }}>
                {money(t.totalCost)}
              </Typography>
            </Box>
            <Box sx={{ flex: 1.3, minWidth: 0, textAlign: "right" }}>
              <Typography variant="caption" sx={{ color: "text.secondary", display: "block", lineHeight: 1.3 }}>
                Margin
              </Typography>
              <Typography
                variant="body2"
                sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 600, color: !t.anyCost ? "text.secondary" : t.breach ? "warning.main" : "text.primary" }}
              >
                {t.anyCost ? `${money(t.grand - t.totalCost)} · ${pct(t.marginPct)}` : "no costs yet"}
              </Typography>
            </Box>
          </Stack>
          <Typography variant="caption" sx={{ color: "text.disabled", display: "block", mb: 0.75, lineHeight: 1.3 }}>
            Guideline {quote.settings.marginGuidelinePct}% · floor {floor}%
          </Typography>
          {t.breach ? (
            // Dense alert, and only the worst THREE offending lines by default:
            // six of them pushed Payment terms off the bottom of the rail. The
            // rest are one click away rather than always costing height
            // (guru 2026-10-11).
            <Alert
              severity="warning"
              variant="outlined"
              sx={{ py: 0.25, px: 1, "& .MuiAlert-message": { width: "100%", py: 0.5 }, "& .MuiAlert-icon": { py: 0.5, mr: 1 } }}
            >
              <Typography variant="caption" sx={{ fontWeight: 700, display: "block" }}>
                Below the {floor}% floor — management notified on save.
              </Typography>
              {t.lowLines.slice(0, showAllLow ? t.lowLines.length : 3).map((l) => (
                <Typography
                  key={l.itemId}
                  variant="caption"
                  component="div"
                  sx={{ cursor: "pointer", lineHeight: 1.4, "&:hover": { textDecoration: "underline" } }}
                  onClick={() => onJumpToItem(l.itemId)}
                >
                  {l.sectionLetter}{l.no} · {pct(l.marginPct)} · {l.description.slice(0, 32)}
                  {l.description.length > 32 ? "…" : ""}
                </Typography>
              ))}
              {t.lowLines.length > 3 && (
                <Typography
                  variant="caption"
                  onClick={() => setShowAllLow((v) => !v)}
                  sx={{ color: "text.secondary", cursor: "pointer", textDecoration: "underline" }}
                >
                  {showAllLow ? "show fewer" : `+${t.lowLines.length - 3} more`}
                </Typography>
              )}
            </Alert>
          ) : t.anyCost ? (
            <Alert severity="success" variant="outlined" sx={{ py: 0, px: 1, "& .MuiAlert-message": { py: 0.5 }, "& .MuiAlert-icon": { py: 0.5, mr: 1 } }}>
              <Typography variant="caption">Margins within guideline.</Typography>
            </Alert>
          ) : null}
        </Box>
      )}

      <Button fullWidth size="small" variant="text" startIcon={<GavelIcon />} onClick={onEditTerms} sx={{ mt: 1, textTransform: "none", py: 0.25, minHeight: 0 }}>
        Payment terms & T&Cs
      </Button>
    </Paper>
  );
}
