"use client";

// One lettered trade section: notes → areas (rooms) → numbered items with
// their "* Includes" bullets, laid out as ONE aligned grid per section with a
// header row so every column reads clearly. Client columns (qty / uom /
// pricing / amount) always; internal columns (cost / margin) when the
// Internal toggle is on.

import React, { memo, useState } from "react";
import { Autocomplete, Box, Button, Checkbox, Chip, IconButton, InputAdornment, Menu, MenuItem, Paper, Stack, TextField, Tooltip, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import LibraryBooksIcon from "@mui/icons-material/LibraryBooksOutlined";
import WarningAmberIcon from "@mui/icons-material/WarningAmberRounded";
import NotesIcon from "@mui/icons-material/NotesOutlined";
import type { PricingMode, QuoteArea, QuoteInclude, QuoteItem, QuoteSection } from "../_lib/types";
import { AREA_SUGGESTIONS, UOM_OPTIONS, emptyArea, emptyItem } from "../_lib/defaults";
import { hasPlaceholders, itemAmount, itemCost, itemMarginPct, money, newId, pct, priceFromCost, sectionTotals } from "../_lib/math";

interface Props {
  section: QuoteSection;
  internalView: boolean;
  readOnly: boolean;
  guidelinePct: number;
  floorPct: number;
  active: boolean;
  /** Ticked line ids (page-level so grouped ops span sections). */
  selectedIds: Set<string>;
  /** Toggle a line's tick; shift extends the range (CIEL 09-01). */
  onToggleSelect: (itemId: string, shift: boolean) => void;
  onChange: (next: QuoteSection) => void;
  onRemove: () => void;
  onOpenLibrary: (areaId: string) => void;
  onFocus: () => void;
}

// Column template shared by the header, item rows and include rows so
// everything lines up. Internal view appends Cost + Margin.
const gridCols = (internal: boolean) => `30px 36px minmax(280px,1fr) 84px 96px 150px 132px${internal ? " 124px 96px" : ""} 40px`;
const MIN_W = (internal: boolean) => (internal ? 1150 : 930);

const numOrNull = (v: string): number | null => {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Numeric field used for qty / amount / cost (commits on blur / Enter). */
function NumField({ value, onChange, disabled, placeholder, adornment, warn }: { value: number | null; onChange: (v: number | null) => void; disabled?: boolean; placeholder?: string; adornment?: string; warn?: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <TextField
      size="small"
      fullWidth
      value={draft ?? (value ?? "")}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setDraft(value == null ? "" : String(value))}
      onBlur={() => {
        if (draft != null) onChange(numOrNull(draft));
        setDraft(null);
      }}
      onKeyDown={(e) => {
        // Enter just commits the value (blur). It must NOT create a new line —
        // CIEL 09-01: designers kept adding rows by accident.
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      disabled={disabled}
      placeholder={placeholder}
      inputProps={{ inputMode: "decimal", style: { textAlign: "right", fontVariantNumeric: "tabular-nums" } }}
      InputProps={adornment ? { startAdornment: <InputAdornment position="start">{adornment}</InputAdornment> } : undefined}
      sx={warn ? { "& .MuiOutlinedInput-root": { "& fieldset": { borderColor: "warning.main" } } } : undefined}
    />
  );
}

const PRICING: Array<{ value: PricingMode; label: string }> = [
  { value: "priced", label: "Priced" },
  { value: "inclusive", label: "Inclusive" },
  { value: "complimentary", label: "Complimentary" },
];

/** Cell wrapper — keeps every row on the shared grid. */
const Cell = ({ children, sx }: { children?: React.ReactNode; sx?: any }) => <Box sx={{ minWidth: 0, ...sx }}>{children}</Box>;

function HeaderRow({ internal }: { internal: boolean }) {
  const H = ({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" | "center" }) => (
    <Typography variant="overline" sx={{ color: "text.secondary", fontSize: 10.5, letterSpacing: 0.6, lineHeight: 1.6, textAlign: align, whiteSpace: "nowrap" }}>
      {children}
    </Typography>
  );
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: gridCols(internal), columnGap: 1, px: 1, pb: 0.5, borderBottom: 1, borderColor: "divider", minWidth: MIN_W(internal) }}>
      <H> </H>
      <H align="right">#</H>
      <H>Description</H>
      <H align="right">Qty</H>
      <H>UOM</H>
      <H>Pricing</H>
      <H align="right">Amount (S$)</H>
      {internal && (
        <>
          <H align="right">Cost (S$)</H>
          <H align="right">Margin</H>
        </>
      )}
      <H> </H>
    </Box>
  );
}

const IncludeRow = memo(function IncludeRow({ inc, internalView, readOnly, onChange, onRemove }: { inc: QuoteInclude; internalView: boolean; readOnly: boolean; onChange: (n: QuoteInclude) => void; onRemove: () => void }) {
  const priced = inc.pricingMode === "priced";
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: gridCols(internalView), columnGap: 1, alignItems: "center", px: 1, py: 0.25, minWidth: MIN_W(internalView) }}>
      <Cell />
      <Cell sx={{ textAlign: "right", color: "text.disabled" }}>*</Cell>
      <Cell sx={{ pl: 2 }}>
        <TextField size="small" fullWidth variant="standard" placeholder="Includes …" value={inc.text} onChange={(e) => onChange({ ...inc, text: e.target.value })} disabled={readOnly} InputProps={{ disableUnderline: true, sx: { fontSize: 13 } }} />
      </Cell>
      <Cell>
        <NumField value={inc.qty ?? null} onChange={(v) => onChange({ ...inc, qty: v })} disabled={readOnly} placeholder="qty" />
      </Cell>
      <Cell />
      <Cell>
        <TextField select size="small" fullWidth value={inc.pricingMode || "inclusive"} onChange={(e) => onChange({ ...inc, pricingMode: e.target.value as PricingMode })} disabled={readOnly}>
          <MenuItem value="inclusive">Inclusive</MenuItem>
          <MenuItem value="priced">Priced</MenuItem>
        </TextField>
      </Cell>
      <Cell>{priced ? <NumField value={inc.amount ?? null} onChange={(v) => onChange({ ...inc, amount: v })} disabled={readOnly} placeholder="0.00" adornment="$" /> : <Typography variant="caption" sx={{ color: "text.disabled", display: "block", textAlign: "right", pr: 1 }}>inclusive</Typography>}</Cell>
      {internalView && (
        <>
          <Cell>
            <NumField value={inc.cost ?? null} onChange={(v) => onChange({ ...inc, cost: v })} disabled={readOnly} placeholder="0.00" adornment="$" />
          </Cell>
          <Cell />
        </>
      )}
      <Cell sx={{ textAlign: "center" }}>
        {!readOnly && (
          <IconButton size="small" onClick={onRemove} sx={{ color: "text.disabled", "&:hover": { color: "error.main" } }}>
            <DeleteIcon sx={{ fontSize: 16 }} />
          </IconButton>
        )}
      </Cell>
    </Box>
  );
});

const ItemRow = memo(function ItemRow({ item, no, internalView, readOnly, guidelinePct, floorPct, selected, onToggleSelect, onChange, onUnbundle }: { item: QuoteItem; no: number; internalView: boolean; readOnly: boolean; guidelinePct: number; floorPct: number; selected: boolean; onToggleSelect: (itemId: string, shift: boolean) => void; onChange: (n: QuoteItem) => void; onUnbundle: () => void }) {
  const [showComponents, setShowComponents] = useState(false);
  const amount = itemAmount(item);
  const cost = itemCost(item);
  const margin = itemMarginPct(item);
  const low = margin != null && margin < floorPct;
  const priced = item.pricingMode === "priced";
  const placeholders = hasPlaceholders(item.description);

  const setCost = (v: number | null) => {
    // Keying a cost pre-fills the price at the guideline margin when the line
    // has no price yet (designer can still override).
    const next: QuoteItem = { ...item, cost: v };
    if (v != null && (item.amount == null || item.amount === 0)) next.amount = priceFromCost(v, guidelinePct);
    onChange(next);
  };

  return (
    <Box sx={{ borderTop: 1, borderColor: "divider", py: 0.75, bgcolor: selected ? "action.selected" : low ? (t) => (t.palette.mode === "dark" ? "rgba(255,167,38,0.07)" : "rgba(255,167,38,0.09)") : "transparent" }}>
      <Box sx={{ display: "grid", gridTemplateColumns: gridCols(internalView), columnGap: 1, alignItems: "start", px: 1, minWidth: MIN_W(internalView) }}>
        <Cell sx={{ pt: 0.25 }}>
          {!readOnly && (
            <Checkbox size="small" checked={selected} onClick={(e) => onToggleSelect(item.id, (e as React.MouseEvent).shiftKey)} sx={{ p: 0.5 }} inputProps={{ "aria-label": "Select line" }} />
          )}
        </Cell>
        <Cell sx={{ textAlign: "right", color: "text.secondary", pt: 1, fontVariantNumeric: "tabular-nums" }}>{no}</Cell>
        <Cell>
          <TextField
            multiline
            minRows={1}
            fullWidth
            size="small"
            placeholder="Describe the work — e.g. Provide Labour & Materials to Construct (L) 2050mm Full Height Casement Wardrobe…"
            value={item.description}
            onChange={(e) => onChange({ ...item, description: e.target.value })}
            disabled={readOnly}
            InputProps={{ sx: { fontSize: 13.5, lineHeight: 1.45 } }}
          />
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.25, minHeight: 16 }}>
            {(item.components?.length ?? 0) > 0 && (
              <Chip
                size="small"
                variant="outlined"
                label={`Lump sum · ${item.components!.length} lines`}
                onClick={() => setShowComponents((v) => !v)}
                sx={{ height: 18, "& .MuiChip-label": { fontSize: 10.5 } }}
              />
            )}
            {item.code && (
              <Typography variant="caption" sx={{ color: "text.disabled" }}>
                {item.code}
              </Typography>
            )}
            {placeholders && (
              <Typography variant="caption" sx={{ color: "warning.main" }}>
                Replace the {"{…}"} placeholders with this project's measurements
              </Typography>
            )}
          </Stack>
        </Cell>
        <Cell>
          <NumField value={item.qty} onChange={(v) => onChange({ ...item, qty: v })} disabled={readOnly} placeholder="1" />
        </Cell>
        <Cell>
          <Autocomplete freeSolo size="small" options={UOM_OPTIONS} value={item.uom} disabled={readOnly} onInputChange={(_, v) => onChange({ ...item, uom: v })} renderInput={(p) => <TextField {...p} placeholder="nos" />} disableClearable />
        </Cell>
        <Cell>
          <TextField select size="small" fullWidth value={item.pricingMode} onChange={(e) => onChange({ ...item, pricingMode: e.target.value as PricingMode })} disabled={readOnly}>
            {PRICING.map((p) => (
              <MenuItem key={p.value} value={p.value}>
                {p.label}
              </MenuItem>
            ))}
          </TextField>
        </Cell>
        <Cell>
          {priced ? (
            <NumField value={item.amount} onChange={(v) => onChange({ ...item, amount: v })} disabled={readOnly} placeholder="0.00" adornment="$" />
          ) : (
            <Chip size="small" variant="outlined" label={item.pricingMode === "inclusive" ? "Inclusive" : "Complimentary"} sx={{ width: "100%", mt: 0.5 }} />
          )}
        </Cell>
        {internalView && (
          <>
            <Cell>
              <NumField value={item.cost} onChange={setCost} disabled={readOnly} placeholder="0.00" adornment="$" warn={low} />
            </Cell>
            <Cell sx={{ pt: 0.5, textAlign: "right" }}>
              <Tooltip title={margin == null ? "Enter a cost to see the margin" : `(${money(amount)} − ${money(cost)}) ÷ ${money(amount)}`}>
                <Chip size="small" icon={low ? <WarningAmberIcon /> : undefined} label={pct(margin)} color={margin == null ? "default" : low ? "warning" : margin >= guidelinePct ? "success" : "default"} variant={margin == null ? "outlined" : "filled"} sx={{ minWidth: 72, fontVariantNumeric: "tabular-nums" }} />
              </Tooltip>
            </Cell>
          </>
        )}
        <Cell />
      </Box>

      {/* Lump-sum internals: the client sees ONE line; the bundled lines live
          here for tracking, and Unbundle restores them (internal view only). */}
      {(item.components?.length ?? 0) > 0 && showComponents && (
        <Box sx={{ ml: `calc(30px + 36px + 16px)`, mr: 1, my: 0.5, p: 1, borderRadius: 1, bgcolor: "action.hover", border: 1, borderColor: "divider" }}>
          {item.components!.map((c, i) => (
            <Stack key={c.id || i} direction="row" spacing={1} sx={{ py: 0.25 }}>
              <Typography variant="caption" sx={{ color: "text.secondary", flex: 1, minWidth: 0 }}>
                {c.description || "(untitled line)"}
              </Typography>
              <Typography variant="caption" sx={{ fontVariantNumeric: "tabular-nums" }}>{money(itemAmount(c))}</Typography>
              {internalView && (
                <Typography variant="caption" sx={{ color: "text.disabled", fontVariantNumeric: "tabular-nums" }}>
                  cost {money(itemCost(c))}
                </Typography>
              )}
            </Stack>
          ))}
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 0.5 }}>
            <Typography variant="caption" sx={{ color: "text.disabled" }}>
              Never printed — the client only sees the lump-sum line above.
            </Typography>
            {!readOnly && (
              <Button size="small" onClick={onUnbundle} sx={{ textTransform: "none", fontSize: 11, py: 0 }}>
                Unbundle
              </Button>
            )}
          </Stack>
        </Box>
      )}

      {item.includes.map((inc) => (
        <IncludeRow key={inc.id} inc={inc} internalView={internalView} readOnly={readOnly} onChange={(n) => onChange({ ...item, includes: item.includes.map((x) => (x.id === n.id ? n : x)) })} onRemove={() => onChange({ ...item, includes: item.includes.filter((x) => x.id !== inc.id) })} />
      ))}

      {!readOnly && (
        <Box sx={{ pl: `calc(36px + 8px + 8px)`, pt: 0.25 }}>
          <Button size="small" startIcon={<AddIcon sx={{ fontSize: 14 }} />} onClick={() => onChange({ ...item, includes: [...item.includes, { id: newId(), text: "", qty: 1, pricingMode: "inclusive" }] })} sx={{ textTransform: "none", color: "text.secondary", fontSize: 12, py: 0, minHeight: 26 }}>
            Includes line
          </Button>
        </Box>
      )}

      {internalView && low && (
        <Box sx={{ px: 1, pl: `calc(36px + 8px + 8px)`, pt: 0.5 }}>
          <TextField size="small" fullWidth placeholder={`Below the ${floorPct}% floor — note the reason for management`} value={item.marginNote || ""} onChange={(e) => onChange({ ...item, marginNote: e.target.value })} disabled={readOnly} InputProps={{ sx: { fontSize: 12.5 }, startAdornment: <InputAdornment position="start"><NotesIcon sx={{ fontSize: 16, color: "warning.main" }} /></InputAdornment> }} />
        </Box>
      )}

    </Box>
  );
});

function AreaBlock({ area, startNo, canRemove, internalView, readOnly, guidelinePct, floorPct, selectedIds, onToggleSelect, onChange, onRemove, onOpenLibrary }: { area: QuoteArea; startNo: number; canRemove: boolean; internalView: boolean; readOnly: boolean; guidelinePct: number; floorPct: number; selectedIds: Set<string>; onToggleSelect: (itemId: string, shift: boolean) => void; onChange: (a: QuoteArea) => void; onRemove: () => void; onOpenLibrary: () => void }) {
  const setItem = (n: QuoteItem) => onChange({ ...area, items: area.items.map((x) => (x.id === n.id ? n : x)) });
  // New lines always append at the END of the area so numbering stays in
  // sequence (CIEL 09-01 — "add item must insert in the correct sequence").
  const addLine = () => onChange({ ...area, items: [...area.items, emptyItem()] });
  return (
    <Box sx={{ minWidth: MIN_W(internalView) }}>
      {/* Area / room heading row */}
      <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 1, pt: 1.25, pb: 0.5 }}>
        <Autocomplete
          freeSolo
          size="small"
          options={AREA_SUGGESTIONS}
          value={area.name}
          disabled={readOnly}
          disableClearable
          onInputChange={(_, v) => onChange({ ...area, name: v })}
          renderInput={(p) => <TextField {...p} variant="standard" placeholder="Area / room" InputProps={{ ...p.InputProps, disableUnderline: true, sx: { fontWeight: 700, fontSize: 13.5, textDecoration: "underline", textUnderlineOffset: 3 } }} />}
          sx={{ minWidth: 240 }}
        />
        <Box sx={{ flex: 1 }} />
        {!readOnly && (
          <>
            <Button size="small" startIcon={<LibraryBooksIcon />} onClick={onOpenLibrary} sx={{ textTransform: "none" }}>
              From library
            </Button>
            <Button size="small" startIcon={<AddIcon />} onClick={addLine} sx={{ textTransform: "none" }}>
              Custom line
            </Button>
            {canRemove && (
              <Tooltip title="Remove this area (and its lines)">
                <IconButton size="small" onClick={onRemove} sx={{ color: "text.disabled", "&:hover": { color: "error.main" } }}>
                  <DeleteIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
            )}
          </>
        )}
      </Stack>
      {area.items.length === 0 && (
        <Typography variant="body2" sx={{ color: "text.disabled", px: 1, pl: 6, py: 1 }}>
          No lines yet — pick from the library (⌘K) or add a custom line.
        </Typography>
      )}
      {area.items.map((it, i) => (
        <ItemRow key={it.id} item={it} no={startNo + i} internalView={internalView} readOnly={readOnly} guidelinePct={guidelinePct} floorPct={floorPct} selected={selectedIds.has(it.id)} onToggleSelect={onToggleSelect} onChange={setItem} onUnbundle={() => onChange({ ...area, items: area.items.flatMap((x) => (x.id === it.id ? (x.components && x.components.length ? x.components : [x]) : [x])) })} />
      ))}
    </Box>
  );
}

export default function SectionCard({ section, internalView, readOnly, guidelinePct, floorPct, active, selectedIds, onToggleSelect, onChange, onRemove, onOpenLibrary, onFocus }: Props) {
  const [menu, setMenu] = useState<null | HTMLElement>(null);
  const t = sectionTotals(section);
  let running = 0;
  const areaStarts = section.areas.map((a) => {
    const s = running + 1;
    running += a.items.length;
    return s;
  });

  return (
    <Paper id={`idq-section-${section.id}`} variant="outlined" onFocusCapture={onFocus} onClick={onFocus} sx={{ borderRadius: 2, overflow: "hidden", borderColor: active ? "primary.main" : "divider", transition: "border-color .15s" }}>
      {/* Section header band */}
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ px: 2, py: 1.25, bgcolor: "action.hover" }}>
        <TextField size="small" variant="standard" value={section.letter} disabled={readOnly} onChange={(e) => onChange({ ...section, letter: e.target.value.toUpperCase().slice(0, 2) })} InputProps={{ disableUnderline: true, sx: { fontWeight: 800, fontSize: 18, width: 34, color: "primary.main" } }} inputProps={{ style: { textAlign: "center" } }} />
        <TextField size="small" variant="standard" fullWidth value={section.title} disabled={readOnly} onChange={(e) => onChange({ ...section, title: e.target.value })} placeholder="Section title" InputProps={{ disableUnderline: true, sx: { fontWeight: 700, fontSize: 15 } }} />
        <Stack alignItems="flex-end" sx={{ whiteSpace: "nowrap" }}>
          <Typography variant="caption" sx={{ color: "text.secondary", lineHeight: 1 }}>
            Sub total
          </Typography>
          <Typography variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
            {money(t.amount)}
          </Typography>
          {internalView && (
            <Typography variant="caption" sx={{ color: t.marginPct != null && t.marginPct < floorPct ? "warning.main" : "text.secondary" }}>
              cost {money(t.cost)} · margin {pct(t.marginPct)}
            </Typography>
          )}
        </Stack>
        {!readOnly && (
          <IconButton size="small" onClick={(e) => setMenu(e.currentTarget)}>
            <MoreVertIcon fontSize="small" />
          </IconButton>
        )}
      </Stack>

      {/* Section notes (printed in italics under the header) */}
      {section.notes.length > 0 && (
        <Box sx={{ px: 2, pt: 1 }}>
          {section.notes.map((n, i) => (
            <Stack key={i} direction="row" spacing={1} alignItems="center">
              <Typography sx={{ color: "text.disabled" }}>*</Typography>
              <TextField size="small" variant="standard" fullWidth value={n} disabled={readOnly} placeholder="Section note" onChange={(e) => onChange({ ...section, notes: section.notes.map((x, j) => (j === i ? e.target.value : x)) })} InputProps={{ disableUnderline: true, sx: { fontStyle: "italic", fontSize: 12.5, color: "text.secondary" } }} />
              {!readOnly && (
                <IconButton size="small" onClick={() => onChange({ ...section, notes: section.notes.filter((_, j) => j !== i) })} sx={{ color: "text.disabled" }}>
                  <DeleteIcon sx={{ fontSize: 16 }} />
                </IconButton>
              )}
            </Stack>
          ))}
        </Box>
      )}

      {/* Lines: one aligned grid for the whole section, horizontally scrollable on narrow screens */}
      <Box sx={{ overflowX: "auto", px: 1, pt: 1.5 }}>
        <HeaderRow internal={internalView} />
        {section.areas.map((a, i) => (
          <AreaBlock key={a.id} area={a} startNo={areaStarts[i]} canRemove={section.areas.length > 1} internalView={internalView} readOnly={readOnly} guidelinePct={guidelinePct} floorPct={floorPct} selectedIds={selectedIds} onToggleSelect={onToggleSelect} onChange={(n) => onChange({ ...section, areas: section.areas.map((x) => (x.id === n.id ? n : x)) })} onRemove={() => onChange({ ...section, areas: section.areas.filter((x) => x.id !== a.id) })} onOpenLibrary={() => onOpenLibrary(a.id)} />
        ))}
      </Box>

      {!readOnly && (
        <Box sx={{ px: 2, py: 1 }}>
          <Button size="small" startIcon={<AddIcon />} onClick={() => onChange({ ...section, areas: [...section.areas, emptyArea("")] })} sx={{ textTransform: "none", color: "text.secondary" }}>
            Add area / room
          </Button>
        </Box>
      )}

      <Menu open={!!menu} anchorEl={menu} onClose={() => setMenu(null)}>
        <MenuItem
          onClick={() => {
            setMenu(null);
            onChange({ ...section, notes: [...section.notes, ""] });
          }}
        >
          Add section note
        </MenuItem>
        <MenuItem
          onClick={() => {
            setMenu(null);
            onRemove();
          }}
          sx={{ color: "error.main" }}
        >
          Delete section
        </MenuItem>
      </Menu>
    </Paper>
  );
}
