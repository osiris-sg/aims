"use client";

// Left rail: the quote's sections (A, B, C…) with live subtotal + margin,
// jump-to, drag-and-drop reorder, and "Add section" from the org's presets.

import React, { useState } from "react";
import { Box, Button, Chip, Divider, List, ListItemButton, ListItemText, Menu, MenuItem, Stack, Tooltip, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import { DndContext, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { QuoteSection, WorkSection } from "../_lib/types";
import { money, pct, sectionTotals } from "../_lib/math";

interface Props {
  sections: QuoteSection[];
  presets: WorkSection[];
  activeId: string | null;
  internalView: boolean;
  readOnly: boolean;
  onJump: (id: string) => void;
  onReorder: (orderedIds: string[]) => void;
  onAddPreset: (ws: WorkSection) => void;
  onAddCustom: () => void;
}

function SortableRow({ section, active, internalView, readOnly, onJump }: { section: QuoteSection; active: boolean; internalView: boolean; readOnly: boolean; onJump: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: section.id, disabled: readOnly });
  const t = sectionTotals(section);
  const low = internalView && t.marginPct != null && t.marginPct < 15;
  return (
    <ListItemButton
      ref={setNodeRef}
      selected={active}
      onClick={() => onJump(section.id)}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      sx={{
        borderRadius: 1.5,
        mb: 0.5,
        alignItems: "flex-start",
        pl: readOnly ? 2 : 0.5,
        opacity: isDragging ? 0.6 : 1,
        boxShadow: isDragging ? 4 : "none",
        bgcolor: isDragging ? "background.paper" : undefined,
        "&.Mui-selected": { bgcolor: "action.selected" },
      }}
    >
      {!readOnly && (
        <Box
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          sx={{ cursor: isDragging ? "grabbing" : "grab", color: "text.disabled", display: "flex", alignItems: "center", pr: 0.25, pt: 0.25, touchAction: "none", "&:hover": { color: "text.secondary" } }}
          aria-label="Drag to reorder"
        >
          <DragIndicatorIcon sx={{ fontSize: 18 }} />
        </Box>
      )}
      <Box sx={{ width: 22, fontWeight: 700, color: "primary.main", pt: 0.25 }}>{section.letter}</Box>
      <ListItemText
        primary={section.title}
        primaryTypographyProps={{ variant: "body2", sx: { fontWeight: 600, lineHeight: 1.25 } }}
        secondary={
          <Stack direction="row" spacing={0.75} alignItems="center" component="span" sx={{ mt: 0.25 }}>
            <Typography component="span" variant="caption" sx={{ fontVariantNumeric: "tabular-nums" }}>
              {money(t.amount)}
            </Typography>
            {internalView && t.marginPct != null && (
              <Chip component="span" size="small" label={pct(t.marginPct)} color={low ? "warning" : "default"} variant="outlined" sx={{ height: 18, "& .MuiChip-label": { px: 0.75, fontSize: 10 } }} />
            )}
          </Stack>
        }
        secondaryTypographyProps={{ component: "div" }}
      />
    </ListItemButton>
  );
}

export default function OutlineRail({ sections, presets, activeId, internalView, readOnly, onJump, onReorder, onAddPreset, onAddCustom }: Props) {
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);
  const used = new Set(sections.map((s) => s.title.toLowerCase()));
  const sensors = useSensors(
    // Small activation distance so a plain click still selects/jumps.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = sections.map((s) => s.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(ids, from, to));
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Typography variant="overline" sx={{ px: 2, pt: 1.5, color: "text.secondary" }}>
        Sections
      </Typography>
      <List dense sx={{ flex: 1, overflowY: "auto", px: 1 }}>
        {sections.length === 0 && (
          <Typography variant="body2" sx={{ color: "text.secondary", px: 1, py: 2 }}>
            No sections yet. Add one below — e.g. Hacking, Masonry, Carpentry.
          </Typography>
        )}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={sections.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            {sections.map((s) => (
              <SortableRow key={s.id} section={s} active={s.id === activeId} internalView={internalView} readOnly={readOnly} onJump={onJump} />
            ))}
          </SortableContext>
        </DndContext>
      </List>
      {!readOnly && (
        <>
          <Divider />
          <Box sx={{ p: 1.5 }}>
            <Button fullWidth size="small" variant="outlined" startIcon={<AddIcon />} onClick={(e) => setAnchor(e.currentTarget)} data-tour="idq-add-section">
              Add section
            </Button>
            <Menu open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)}>
              {presets.map((p) => (
                <MenuItem
                  key={p.id}
                  disabled={used.has(p.title.toLowerCase())}
                  onClick={() => {
                    setAnchor(null);
                    onAddPreset(p);
                  }}
                >
                  <Box sx={{ width: 24, fontWeight: 700, color: "primary.main" }}>{p.letter}</Box>
                  {p.title}
                </MenuItem>
              ))}
              {presets.length > 0 && <Divider />}
              <MenuItem
                onClick={() => {
                  setAnchor(null);
                  onAddCustom();
                }}
              >
                <Tooltip title="A blank section you name yourself">
                  <span>Custom section…</span>
                </Tooltip>
              </MenuItem>
            </Menu>
          </Box>
        </>
      )}
    </Box>
  );
}
