"use client";

// Round BG — link one file to several orders / shipments in one go: a checklist grouped Orders / Shipments (by
// order, with "Select all shipments of #18"), a search (#n, #n-s, B/L, customer) and the current record pre-ticked.
// Used by the upload dialog, "+ link" on a file, the email inbox picker and the email file rows (compact popover).
// For payment proofs the ticked shipments' CIs are listed with their total and the difference to the proof's amount.

import React, { useMemo, useState } from "react";
import { Box, Button, Checkbox, Chip, CircularProgress, InputAdornment, Popover, Stack, TextField, Typography } from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import { useTranslations } from "next-intl";
import { ciTotals, groupItems, toggleAll, toggleOne, type CheckItem } from "../_lib/link-checklist";
import { fmtMoney } from "../_lib/format";

export type { CheckItem } from "../_lib/link-checklist";

export default function LinkChecklist({
  items,
  value,
  onChange,
  loading,
  disabled,
  label,
  maxHeight = 280,
  error,
}: {
  items: CheckItem[];
  value: string[];
  onChange: (keys: string[]) => void;
  loading?: boolean;
  disabled?: boolean;
  label?: string;
  maxHeight?: number;
  error?: boolean;
}) {
  const t = useTranslations("orders.linkChecklist");
  const [q, setQ] = useState("");
  const ticked = useMemo(() => new Set(value), [value]);
  const g = useMemo(() => groupItems(items, q, ticked), [items, q, ticked]);
  const row = (it: CheckItem, indent = false) => (
    <Stack key={it.key} component="label" direction="row" alignItems="center" spacing={0.5} sx={{ pl: indent ? 2 : 0, pr: 1, py: 0.1, cursor: disabled ? "default" : "pointer", borderRadius: 1, "&:hover": { bgcolor: "action.hover" } }} data-tour="link-checklist-row">
      <Checkbox size="small" checked={ticked.has(it.key)} disabled={disabled} onChange={() => onChange(toggleOne(value, it.key))} sx={{ p: 0.5 }} />
      <Typography variant="body2" sx={{ fontWeight: 700, flexShrink: 0 }}>{it.ref}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.detail ?? ""}</Typography>
    </Stack>
  );
  const head = (text: string) => <Typography variant="overline" color="text.secondary" sx={{ display: "block", lineHeight: 1.6, mt: 0.5 }}>{text}</Typography>;
  const none = !g.orders.length && !g.shipments.length && !g.other.length;
  return (
    <Box data-tour="link-checklist">
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, flex: 1 }} color={error ? "error" : undefined}>{label ?? t("label")}</Typography>
        <Chip size="small" label={t("ticked", { n: value.length })} color={value.length ? "primary" : "default"} variant="outlined" />
        {value.length > 0 && !disabled && <Button size="small" onClick={() => onChange([])}>{t("clear")}</Button>}
      </Stack>
      <TextField
        size="small"
        fullWidth
        placeholder={t("search")}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        disabled={disabled}
        InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>, endAdornment: loading ? <CircularProgress size={16} /> : undefined }}
        inputProps={{ "data-tour": "link-checklist-search" }}
      />
      <Box sx={{ mt: 0.5, maxHeight, overflowY: "auto", border: 1, borderColor: error ? "error.main" : "divider", borderRadius: 1, px: 1, pb: 0.5 }}>
        {none && <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>{loading ? t("loading") : t("none")}</Typography>}
        {g.orders.length > 0 && head(t("orders"))}
        {g.orders.map((it) => row(it))}
        {g.shipments.length > 0 && head(t("shipments"))}
        {g.shipments.map((grp) => {
          const keys = grp.items.map((x) => x.key);
          const all = keys.every((k) => ticked.has(k));
          return (
            <Box key={grp.orderRef ?? "-"}>
              {grp.orderRef && grp.items.length > 1 && (
                <Button size="small" sx={{ ml: 0.5, py: 0, minHeight: 0, textTransform: "none" }} disabled={disabled} onClick={() => onChange(toggleAll(value, keys))} data-tour="link-checklist-all">
                  {all ? t("unselectAll", { ref: grp.orderRef }) : t("selectAll", { ref: grp.orderRef, n: grp.items.length })}
                </Button>
              )}
              {grp.items.map((it) => row(it, !!grp.orderRef && grp.items.length > 1))}
            </Box>
          );
        })}
        {g.other.length > 0 && head(t("other"))}
        {g.other.map((it) => row(it))}
      </Box>
    </Box>
  );
}

/** Part 2.3: the ticked shipments' CIs with their total, and the difference to the proof's amount (when entered). */
export function CiTotals({ items, value, proofAmount, onProofAmount }: { items: CheckItem[]; value: string[]; proofAmount: string; onProofAmount: (v: string) => void }) {
  const t = useTranslations("orders.linkChecklist");
  const n = Number(String(proofAmount).replace(/[,\s]/g, ""));
  const c = ciTotals(items, value, proofAmount.trim() ? n : null);
  if (!c.lines.length) return null;
  return (
    <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.25 }} data-tour="link-checklist-ci">
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>{t("ciTitle")}</Typography>
      {c.lines.map((l) => (
        <Stack key={l.key} direction="row" spacing={1} sx={{ py: 0.1 }}>
          <Typography variant="body2" sx={{ width: 64, fontWeight: 700 }}>{l.ref}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>{l.ciNo ? t("ciNo", { no: l.ciNo }) : t("ciNoMissing")}</Typography>
          <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }}>{l.amount !== null ? fmtMoney(l.amount, l.currency) : t("noAmount")}</Typography>
        </Stack>
      ))}
      <Stack direction="row" spacing={1} sx={{ borderTop: 1, borderColor: "divider", mt: 0.5, pt: 0.5 }}>
        <Typography variant="body2" sx={{ flex: 1, fontWeight: 800 }}>{t("ciTotal", { n: c.lines.length })}</Typography>
        <Typography variant="body2" sx={{ fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{c.total !== null ? fmtMoney(c.total, c.currency) : t("mixed")}</Typography>
      </Stack>
      {c.missing > 0 && <Typography variant="caption" color="warning.main" component="div">{t("missing", { n: c.missing })}</Typography>}
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }} sx={{ mt: 1 }}>
        <TextField size="small" label={t("proofAmount", { cur: c.currency ?? "USD" })} helperText={t("optional")} value={proofAmount} onChange={(e) => onProofAmount(e.target.value)} sx={{ width: { xs: "100%", sm: 260 }, flexShrink: 0 }} inputProps={{ inputMode: "decimal" }} />
        {c.difference !== null && (
          <Typography variant="body2" color={c.difference === 0 ? "success.main" : "warning.main"} sx={{ fontWeight: 700 }} data-tour="link-checklist-diff">
            {c.difference === 0 ? t("matches") : t("difference", { amount: fmtMoney(Math.abs(c.difference), c.currency), dir: c.difference > 0 ? t("more") : t("less") })}
          </Typography>
        )}
      </Stack>
      <Typography variant="caption" color="text.secondary">{t("noBlock")}</Typography>
    </Box>
  );
}

/** The compact form for the email file rows: "Link to: #18-1, #18-2 ▾" opening the checklist in a popover. */
export function LinkChecklistButton({ items, value, onChange, label, error }: { items: CheckItem[]; value: string[]; onChange: (keys: string[]) => void; label: string; error?: boolean }) {
  const t = useTranslations("orders.linkChecklist");
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const refs = value.map((k) => items.find((i) => i.key === k)?.ref ?? k);
  return (
    <>
      <Button variant="outlined" color={error ? "error" : "inherit"} onClick={(e) => setPos({ left: e.clientX, top: e.clientY })} endIcon={<ArrowDropDownIcon />} sx={{ justifyContent: "space-between", textTransform: "none", flex: 2, minWidth: 0 }} data-tour="answer-file-targets">
        <Typography variant="body2" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}: {refs.length ? refs.join(", ") : t("nothing")}</Typography>
      </Button>
      <Popover open={!!pos} onClose={() => setPos(null)} anchorReference="anchorPosition" anchorPosition={pos ?? undefined} slotProps={{ paper: { sx: { p: 1.5, width: 420, maxWidth: "calc(100vw - 32px)" } } }}>
        <LinkChecklist items={items} value={value} onChange={onChange} label={label} />
        <Stack direction="row" justifyContent="flex-end" sx={{ mt: 1 }}>
          <Button size="small" variant="contained" onClick={() => setPos(null)}>{t("done")}</Button>
        </Stack>
      </Popover>
    </>
  );
}

type OrderLike = { id: string; orderNo: number; customerName?: string | null; productLine?: string | null };
type ShipLike = { id: string; ref?: string | null; seqNo?: number | null; order?: { orderNo: number } | null; customerName?: string | null; blNumber?: string | null; productLine?: string | null; ciNumber?: string | null; ciAmount?: unknown; currency?: string | null };
type TargetLike = { kind: CheckItem["kind"]; id: string; label: string };
export const targetKey = (t: { kind: string; id: string }) => `${t.kind}:${t.id}`;
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** The checklist rows from the Orders / Shipments lists, plus any preset target the lists don't have (its label as the ref). */
export function tradeCheckItems(orders: OrderLike[], shipments: ShipLike[], extra: TargetLike[], blPending: string): CheckItem[] {
  const out: CheckItem[] = [
    ...orders.map((o) => ({ key: targetKey({ kind: "order", id: o.id }), kind: "order" as const, ref: `#${o.orderNo}`, detail: [o.customerName, o.productLine].filter(Boolean).join(" · "), customer: o.customerName ?? null })),
    ...shipments.map((s) => {
      const ref = s.ref || (s.order ? `#${s.order.orderNo}-${s.seqNo ?? "?"}` : s.blNumber || "?");
      return {
        key: targetKey({ kind: "shipment", id: s.id }),
        kind: "shipment" as const,
        ref,
        orderRef: s.order ? `#${s.order.orderNo}` : (/^(#\d+)-/.exec(ref)?.[1] ?? null),
        detail: [s.customerName, s.blNumber ? `B/L ${s.blNumber}` : blPending, s.productLine].filter(Boolean).join(" · "),
        customer: s.customerName ?? null,
        bl: s.blNumber ?? null,
        ciNo: s.ciNumber ?? null,
        ciAmount: num(s.ciAmount),
        currency: s.currency ?? null,
      };
    }),
  ];
  for (const t of extra) {
    const k = targetKey(t);
    if (out.some((o) => o.key === k)) continue;
    const ref = /#\d+(?:-\d+)?/.exec(t.label)?.[0] ?? t.label;
    out.push({ key: k, kind: t.kind, ref, detail: ref === t.label ? null : t.label, orderRef: /^(#\d+)-/.exec(ref)?.[1] ?? null });
  }
  return out;
}
