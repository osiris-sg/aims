"use client";

// One widget on the dashboard: the card chrome, plus the controls that only
// appear while customising.
//
// Dragging is deliberately limited to the handle rather than the whole card —
// the widgets underneath are interactive (clickable product rows, a pannable
// map), and a whole-card drag surface would swallow those gestures.

import React from "react";
import { Box, Card, CardContent, IconButton, Stack, Tooltip, Typography } from "@mui/material";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import CloseIcon from "@mui/icons-material/Close";

interface Props {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  bare?: boolean;
  editing: boolean;
  onRemove: () => void;
  children: React.ReactNode;
}

export default function WidgetFrame({ title, subtitle, action, bare, editing, onRemove, children }: Props) {
  return (
    // The grid sizes this box; the card fills it, and the body scrolls inside
    // rather than the card growing past the cell it was given.
    <Box sx={{ height: "100%", width: "100%" }}>
      <Card
        variant="outlined"
        sx={{
          height: "100%",
          display: "flex",
          flexDirection: "column",
          position: "relative",
          overflow: "hidden",
          // While customising, make the cards read as movable objects.
          borderStyle: editing ? "dashed" : "solid",
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
                  {/* The grid starts a drag from this class only. */}
                  <IconButton
                    size="small"
                    className="widget-drag-handle"
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
                <Tooltip title="Remove from dashboard">
                  <IconButton size="small" onClick={onRemove} sx={{ color: "error.main" }}>
                    <CloseIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </Stack>
          )}

          <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "auto" }}>{children}</Box>
        </CardContent>
      </Card>

    </Box>
  );
}
