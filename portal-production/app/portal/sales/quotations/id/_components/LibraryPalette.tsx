"use client";

// ⌘K palette over the org's work library. Filters by the target section by
// default, searches across all, shows unit price / cost, and drops the picked
// item (description template + default includes + pricing) into the area.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Button, Chip, Dialog, DialogContent, IconButton, InputAdornment, List, ListItemButton, ListItemText, MenuItem, Stack, TextField, Typography } from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import EditIcon from "@mui/icons-material/EditOutlined";
import type { QuoteItem, WorkItem, WorkSection } from "../_lib/types";
import { emptyItem } from "../_lib/defaults";
import { money, newId, priceFromCost } from "../_lib/math";

interface Props {
  open: boolean;
  items: WorkItem[];
  sections: WorkSection[];
  targetSectionTitle: string | null;
  guidelinePct: number;
  onClose: () => void;
  onPick: (item: QuoteItem) => void;
  onCustom: () => void;
  /** Managers only (guru 2026-10-02): edit library items right here. */
  canEdit?: boolean;
  onEdit?: (id: string, patch: any) => Promise<void>;
}

export function workItemToQuoteItem(w: WorkItem, guidelinePct: number): QuoteItem {
  const qty = 1;
  const cost = w.unitCost != null ? w.unitCost * qty : null;
  const price = w.unitPrice != null ? w.unitPrice * qty : cost != null ? priceFromCost(cost, guidelinePct) : null;
  const mode = (w.pricingMode as any) || "priced";
  return emptyItem({
    workItemId: w.id,
    code: w.code,
    description: w.descriptionTemplate || w.name,
    qty,
    uom: w.uom || "nos",
    amount: mode === "priced" ? price : null,
    pricingMode: mode,
    cost,
    includes: (w.includes || []).map((i) => ({ id: newId(), text: i.text, qty: i.qty ?? 1, pricingMode: "inclusive" as const })),
  });
}

export default function LibraryPalette({ open, items, sections, targetSectionTitle, guidelinePct, onClose, onPick, onCustom, canEdit, onEdit }: Props) {
  // In-palette edit form state (managers only).
  const [editing, setEditing] = useState<WorkItem | null>(null);
  const [draft, setDraft] = useState<any>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const startEdit = (w: WorkItem) => {
    setDraft({
      descriptionTemplate: w.descriptionTemplate || w.name,
      unitPrice: w.unitPrice != null ? String(w.unitPrice) : "",
      unitCost: w.unitCost != null ? String(w.unitCost) : "",
      uom: w.uom || "nos",
      workSectionId: w.workSectionId || "",
    });
    setEditing(w);
  };
  const saveEdit = async () => {
    if (!editing || !onEdit) return;
    setSavingEdit(true);
    try {
      await onEdit(editing.id, {
        name: (draft.descriptionTemplate || "").slice(0, 120) || editing.name,
        descriptionTemplate: draft.descriptionTemplate || null,
        unitPrice: draft.unitPrice === "" ? null : Number(draft.unitPrice),
        unitCost: draft.unitCost === "" ? null : Number(draft.unitCost),
        uom: draft.uom || null,
        workSectionId: draft.workSectionId || null,
      });
      setEditing(null);
    } finally {
      setSavingEdit(false);
    }
  };
  const [q, setQ] = useState("");
  const [sectionId, setSectionId] = useState<string | "all">("all");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setCursor(0);
    const target = sections.find((s) => s.title.toLowerCase() === (targetSectionTitle || "").toLowerCase());
    setSectionId(target?.id || "all");
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [open, targetSectionTitle, sections]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return items
      .filter((w) => sectionId === "all" || w.workSectionId === sectionId)
      .filter((w) => !term || `${w.code || ""} ${w.name} ${w.descriptionTemplate || ""}`.toLowerCase().includes(term))
      .slice(0, 60);
  }, [items, q, sectionId]);

  useEffect(() => setCursor(0), [filtered.length, q, sectionId]);

  const pick = (w: WorkItem) => {
    onPick(workItemToQuoteItem(w, guidelinePct));
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md" PaperProps={{ sx: { borderRadius: 2, height: "70vh" } }}>
      <DialogContent sx={{ p: 0, display: "flex", flexDirection: "column" }}>
        <Box sx={{ p: 2, pb: 1, borderBottom: 1, borderColor: "divider" }}>
          <TextField
            inputRef={inputRef}
            fullWidth
            size="small"
            placeholder="Search the work library…  (↑↓ to move, Enter to add, Esc to close)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((c) => Math.min(c + 1, filtered.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => Math.max(c - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (filtered[cursor]) pick(filtered[cursor]);
                else onCustom();
              }
            }}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }}
          />
          <Stack direction="row" spacing={0.75} sx={{ mt: 1, flexWrap: "wrap", rowGap: 0.75 }}>
            <Chip size="small" label="All" color={sectionId === "all" ? "primary" : "default"} onClick={() => setSectionId("all")} />
            {sections.map((s) => (
              <Chip key={s.id} size="small" label={`${s.letter ? `${s.letter} · ` : ""}${s.title}`} color={sectionId === s.id ? "primary" : "default"} variant={sectionId === s.id ? "filled" : "outlined"} onClick={() => setSectionId(s.id)} />
            ))}
          </Stack>
        </Box>
        {editing && (
          <Box sx={{ p: 2, borderBottom: 1, borderColor: "divider", bgcolor: "action.hover" }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
              Edit library item {editing.code ? `· ${editing.code}` : ""}
            </Typography>
            <Stack spacing={1.5}>
              <TextField label="Description" size="small" fullWidth multiline minRows={2} value={draft.descriptionTemplate} onChange={(e) => setDraft({ ...draft, descriptionTemplate: e.target.value })} />
              <Stack direction="row" spacing={1}>
                <TextField label="Unit price (S$)" size="small" value={draft.unitPrice} onChange={(e) => { if (/^[0-9]*\.?[0-9]*$/.test(e.target.value)) setDraft({ ...draft, unitPrice: e.target.value }); }} inputProps={{ inputMode: "decimal" }} sx={{ width: 140 }} />
                <TextField label="Unit cost (S$)" size="small" value={draft.unitCost} onChange={(e) => { if (/^[0-9]*\.?[0-9]*$/.test(e.target.value)) setDraft({ ...draft, unitCost: e.target.value }); }} inputProps={{ inputMode: "decimal" }} sx={{ width: 140 }} />
                <TextField label="UOM" size="small" value={draft.uom} onChange={(e) => setDraft({ ...draft, uom: e.target.value })} sx={{ width: 100 }} />
                <TextField label="Section" select size="small" value={draft.workSectionId} onChange={(e) => setDraft({ ...draft, workSectionId: e.target.value })} sx={{ minWidth: 200 }}>
                  {sections.map((sec) => (
                    <MenuItem key={sec.id} value={sec.id}>{sec.letter ? `${sec.letter} · ` : ""}{sec.title}</MenuItem>
                  ))}
                </TextField>
              </Stack>
              <Stack direction="row" spacing={1} justifyContent="flex-end">
                <Button size="small" onClick={() => setEditing(null)} disabled={savingEdit} sx={{ textTransform: "none" }}>Cancel</Button>
                <Button size="small" variant="contained" onClick={saveEdit} disabled={savingEdit} sx={{ textTransform: "none" }}>{savingEdit ? "Saving…" : "Save to library"}</Button>
              </Stack>
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                Changes apply to the library for future quotations — lines already in this quote keep their values.
              </Typography>
            </Stack>
          </Box>
        )}
        <List dense sx={{ flex: 1, overflowY: "auto", py: 0.5 }}>
          {filtered.length === 0 && (
            <Typography variant="body2" sx={{ color: "text.secondary", p: 3, textAlign: "center" }}>
              Nothing matches. Press Enter to add a custom line instead.
            </Typography>
          )}
          {filtered.map((w, i) => (
            <ListItemButton key={w.id} selected={i === cursor} onMouseEnter={() => setCursor(i)} onClick={() => pick(w)} sx={{ alignItems: "flex-start", py: 1 }}>
              <Typography sx={{ width: 44, color: "text.disabled", fontVariantNumeric: "tabular-nums", pt: 0.25 }} variant="caption">
                {w.code}
              </Typography>
              <ListItemText
                primary={w.descriptionTemplate || w.name}
                primaryTypographyProps={{ variant: "body2", sx: { lineHeight: 1.35 } }}
                secondary={
                  <Stack component="span" direction="row" spacing={1} sx={{ mt: 0.25 }}>
                    <Typography component="span" variant="caption" sx={{ color: "text.secondary" }}>
                      {w.workSection?.title}
                    </Typography>
                    {w.includes?.length ? (
                      <Typography component="span" variant="caption" sx={{ color: "text.disabled" }}>
                        · {w.includes.length} include{w.includes.length === 1 ? "" : "s"}
                      </Typography>
                    ) : null}
                  </Stack>
                }
                secondaryTypographyProps={{ component: "div" }}
              />
              {canEdit && (
                <IconButton
                  size="small"
                  sx={{ mr: 0.5, mt: 0.25, opacity: 0.6, "&:hover": { opacity: 1 } }}
                  onClick={(e) => {
                    e.stopPropagation();
                    startEdit(w);
                  }}
                  aria-label="Edit library item"
                >
                  <EditIcon sx={{ fontSize: 16 }} />
                </IconButton>
              )}
              <Stack alignItems="flex-end" sx={{ pl: 1, whiteSpace: "nowrap" }}>
                {w.pricingMode && w.pricingMode !== "priced" ? (
                  <Chip size="small" variant="outlined" label={w.pricingMode === "inclusive" ? "Inclusive" : "Complimentary"} />
                ) : (
                  <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                    {w.unitPrice != null ? `$${money(w.unitPrice)}` : "—"}
                    <Typography component="span" variant="caption" sx={{ color: "text.secondary" }}>
                      {" "}/ {w.uom || "nos"}
                    </Typography>
                  </Typography>
                )}
                {w.unitCost != null && (
                  <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    cost ${money(w.unitCost)}
                  </Typography>
                )}
              </Stack>
            </ListItemButton>
          ))}
        </List>
        <Box sx={{ px: 2, py: 1, borderTop: 1, borderColor: "divider" }}>
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            {filtered.length} item{filtered.length === 1 ? "" : "s"} · unit price × qty becomes the line amount; you can edit anything after adding.
          </Typography>
        </Box>
      </DialogContent>
    </Dialog>
  );
}
