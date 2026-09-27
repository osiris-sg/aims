"use client";

// The dashboard grid.
//
// This replaces a sortable list: a sortable list can only reorder, so dragging
// a half-width card past a quarter-width one produced the shuffling that felt
// wrong, and sizing had to hide in a menu. A real grid gives what people expect
// from a dashboard — pick a card up, see a placeholder showing exactly where it
// will land, drop it anywhere, and drag its corner to resize.
//
// Client-only by construction: the grid needs a measured container width, so
// the caller loads this with `ssr: false`.

import React, { useMemo } from "react";
import { Box, GlobalStyles, useTheme } from "@mui/material";
// v2 ships the v1-shaped API (isDraggable/layouts/onDragStop) under
// /legacy; useContainerWidth is only on the v2 root entrypoint.
import { Responsive } from "react-grid-layout/legacy";
import { useContainerWidth } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { ROW_H, WIDGET_BY_ID } from "./widgets";

export interface GridEntry {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

// One column per phone, so a widget is never squeezed below readability; the
// stored spans apply from the md breakpoint up.
const BREAKPOINTS = { lg: 1200, md: 900, sm: 600, xs: 0 };
const COLS = { lg: 12, md: 12, sm: 6, xs: 1 };

export default function GridBoard({
  entries,
  editing,
  onChange,
  children,
}: {
  entries: GridEntry[];
  editing: boolean;
  onChange: (next: GridEntry[]) => void;
  /** One node per entry id. */
  children: (id: string) => React.ReactNode;
}) {
  const { width, containerRef, mounted } = useContainerWidth();
  const theme = useTheme();
  const dark = theme.palette.mode === "dark";

  const layout = useMemo(
    () =>
      entries.map((e) => {
        const def = WIDGET_BY_ID[e.id];
        return {
          i: e.id,
          x: e.x,
          y: e.y,
          w: e.w,
          h: e.h,
          minW: def?.minW ?? 2,
          minH: def?.minH ?? 2,
        };
      }),
    [entries],
  );

  return (
    <Box ref={containerRef} sx={{ width: "100%", mx: -1 }}>
      {/* The library ships structural CSS only; the look is ours, and has to
          hold in both themes. */}
      <GlobalStyles
        styles={{
          ".react-grid-item.react-grid-placeholder": {
            background: theme.palette.primary.main,
            opacity: 0.18,
            borderRadius: 8,
            border: `2px dashed ${theme.palette.primary.main}`,
            transitionDuration: "100ms",
          },
          ".react-grid-item.react-draggable-dragging": {
            zIndex: 20,
            cursor: "grabbing",
            "& > *": { boxShadow: theme.shadows[8] },
          },
          ".react-grid-item.resizing": { zIndex: 20, opacity: 0.95 },
          // Replace the library's background-image arrow with a visible corner
          // grip — the default is nearly invisible on a dark surface.
          ".react-grid-item > .react-resizable-handle::after": {
            content: '""',
            position: "absolute",
            right: 5,
            bottom: 5,
            width: 9,
            height: 9,
            borderRight: `2px solid ${dark ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.42)"}`,
            borderBottom: `2px solid ${dark ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.42)"}`,
            borderBottomRightRadius: 2,
          },
          ".react-grid-item > .react-resizable-handle": { backgroundImage: "none" },
        }}
      />
      {mounted && (
        <Responsive
          layouts={{ lg: layout, md: layout, sm: layout, xs: layout }}
          breakpoints={BREAKPOINTS}
          cols={COLS}
          width={width}
          rowHeight={ROW_H}
          margin={[16, 16]}
          containerPadding={[8, 0]}
          isDraggable={editing}
          isResizable={editing}
          // Only the header grip starts a drag: the widgets underneath are
          // interactive (clickable rows, a pannable map) and a whole-card drag
          // surface would swallow those gestures.
          draggableHandle=".widget-drag-handle"
          resizeHandles={["se"]}
          // Cards rise to fill gaps left above them, so the board never keeps
          // a hole after something is removed or shrunk.
          compactType="vertical"
          onDragStop={(l: readonly any[]) => onChange(l.map((it) => ({ id: it.i, x: it.x, y: it.y, w: it.w, h: it.h })))}
          onResizeStop={(l: readonly any[]) => onChange(l.map((it) => ({ id: it.i, x: it.x, y: it.y, w: it.w, h: it.h })))}
        >
          {entries.map((e) => (
            <div key={e.id}>{children(e.id)}</div>
          ))}
        </Responsive>
      )}
    </Box>
  );
}
