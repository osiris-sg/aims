"use client";

// One widget on the dashboard: the card chrome, plus the controls that only
// appear while customising.
//
// Dragging is deliberately limited to the handle rather than the whole card —
// the widgets underneath are interactive (clickable product rows, a pannable
// map), and a whole-card drag surface would swallow those gestures.

import React, { useState } from "react";
import {
  Box,
  Card,
  CardContent,
  IconButton,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import CloseIcon from "@mui/icons-material/Close";
import CheckIcon from "@mui/icons-material/Check";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { WIDTH_CHOICES } from "./widgets";

interface Props {
  id: string;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  bare?: boolean;
  width: number;
  editing: boolean;
  onWidth: (w: number) => void;
  onRemove: () => void;
  children: React.ReactNode;
}

export default function WidgetFrame({
  id,
  title,
  subtitle,
  action,
  bare,
  width,
  editing,
  onWidth,
  onRemove,
  children,
}: Props) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !editing,
  });
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null);

  return (
    <Box
      ref={setNodeRef}
      sx={{
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 10 : 0,
        opacity: isDragging ? 0.85 : 1,
        height: "100%",
      }}
    >
      <Card
        variant="outlined"
        sx={{
          height: "100%",
          display: "flex",
          flexDirection: "column",
          position: "relative",
          boxShadow: isDragging ? 6 : 0,
          // While customising, make the cards read as movable objects.
          borderStyle: editing ? "dashed" : "solid",
          borderColor: isDragging ? "primary.main" : "divider",
        }}
      >
        <CardContent
          sx={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            p: { xs: 1.5, md: 2 },
            "&:last-child": { pb: { xs: 1.5, md: 2 } },
          }}
        >
          {/* A stat tile draws its own compact body, so it only gets a header
              row while customising — otherwise the title would appear twice. */}
          {(!bare || editing) && (
            <Stack
              direction={{ xs: "column", sm: "row" }}
              sx={{ mb: bare ? 0.5 : 1.5, gap: 1 }}
              alignItems={{ xs: "flex-start", sm: "center" }}
            >
              {editing && (
                <Tooltip title="Drag to move">
                  <IconButton
                    size="small"
                    ref={setActivatorNodeRef}
                    {...attributes}
                    {...listeners}
                    sx={{ cursor: "grab", touchAction: "none", ml: -0.5, "&:active": { cursor: "grabbing" } }}
                  >
                    <DragIndicatorIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
              <Box sx={{ flex: 1, minWidth: 0 }}>
                {!bare && (
                  <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                    {title}
                  </Typography>
                )}
                {/* A stat tile labels itself in its body, so the header stays
                    empty even while customising — otherwise the name appears
                    twice on the same card. */}
                {subtitle && !bare && (
                  <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    {subtitle}
                  </Typography>
                )}
              </Box>
              {!editing && action}
              {editing && (
                <Stack direction="row" spacing={0.5}>
                  <Tooltip title="Size">
                    <IconButton size="small" onClick={(e) => setMenuPos({ left: e.clientX, top: e.clientY })}>
                      <MoreVertIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Remove from dashboard">
                    <IconButton size="small" onClick={onRemove} sx={{ color: "error.main" }}>
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>
              )}
            </Stack>
          )}

          <Box sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
        </CardContent>
      </Card>

      {/* Anchored to the click position, per the house rule for row menus —
          an element anchor detaches when the grid re-renders mid-drag. */}
      <Menu
        anchorReference="anchorPosition"
        anchorPosition={menuPos || undefined}
        open={!!menuPos}
        onClose={() => setMenuPos(null)}
      >
        {WIDTH_CHOICES.map((c) => (
          <MenuItem
            key={c.w}
            selected={c.w === width}
            onClick={() => {
              onWidth(c.w);
              setMenuPos(null);
            }}
          >
            {c.w === width ? (
              <CheckIcon fontSize="small" sx={{ mr: 1 }} />
            ) : (
              <Box sx={{ width: 20, mr: 1, display: "inline-block" }} />
            )}
            <ListItemText primary={c.label} />
          </MenuItem>
        ))}
      </Menu>
    </Box>
  );
}
