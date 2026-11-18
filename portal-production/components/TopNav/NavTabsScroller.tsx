"use client";

// A row of top bar tabs that may be wider than the bar (WCT round 12,
// 2026-11-19: "users don't know it scrolls"). It scrolls as before (wheel,
// trackpad, touch) with no scrollbar, and on each side where tabs are hidden it
// shows an arrow over a soft fade; pressing the arrow scrolls that way. No
// arrow, no fade when everything fits. Used by both top bars (TopNavBar and
// the role-home bar); fixed items (the role-home bar's ⌂ and module name) sit
// outside it so they never scroll away.

import * as React from "react";
import { Box, IconButton, alpha } from "@mui/material";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import { overflowSides, scrollStep } from "@/helpers/navOverflow";

export default function NavTabsScroller({
  children,
  fade,
  arrowColor,
  gap = 0,
  testId,
}: {
  children: React.ReactNode;
  /** The bar's background colour: the fade runs from it to transparent. */
  fade: string;
  arrowColor: string;
  gap?: number;
  testId?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [sides, setSides] = React.useState({ left: false, right: false });
  const measure = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const next = overflowSides(el.scrollLeft, el.clientWidth, el.scrollWidth);
    setSides((s) => (s.left === next.left && s.right === next.right ? s : next));
    // An arrow that just hid itself (the end was reached) must not keep focus: its focus
    // highlight stayed on screen as a stray circle (round 12 review).
    const active = typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null;
    const side = active?.dataset?.testid === "nav-scroll-left" ? "left" : active?.dataset?.testid === "nav-scroll-right" ? "right" : null;
    if (side && !next[side] && el.parentElement?.contains(active)) active?.blur();
  }, []);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    // The bar's width (window resize) and the tabs' width (another module's tabs, labels loading) both matter.
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    Array.from(el.children).forEach((c) => ro?.observe(c));
    window.addEventListener("resize", measure);
    return () => {
      el.removeEventListener("scroll", measure);
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure, children]);

  const nudge = (dir: -1 | 1) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * scrollStep(el.clientWidth), behavior: "smooth" });
  };

  const edge = (side: "left" | "right") => {
    const show = sides[side];
    return (
      <Box
        aria-hidden={!show}
        sx={{
          position: "absolute",
          top: 0,
          bottom: 0,
          [side]: 0,
          width: 56,
          display: "flex",
          alignItems: "center",
          justifyContent: side === "left" ? "flex-start" : "flex-end",
          background: `linear-gradient(to ${side === "left" ? "right" : "left"}, ${fade} 45%, transparent)`,
          opacity: show ? 1 : 0,
          // Hidden at once (no fade-out), so nothing of the arrow lingers once the end is reached.
          visibility: show ? "visible" : "hidden",
          pointerEvents: show ? "auto" : "none",
          transition: show ? "opacity .15s" : "none",
          zIndex: 1,
        }}
      >
        <IconButton
          size="small"
          tabIndex={show ? 0 : -1}
          aria-label={side === "left" ? "Scroll tabs left" : "Scroll tabs right"}
          data-testid={`nav-scroll-${side}`}
          onClick={() => nudge(side === "left" ? -1 : 1)}
          disableFocusRipple
          sx={{
            color: arrowColor,
            width: 30,
            height: 30,
            p: 0,
            bgcolor: alpha(arrowColor, 0.14),
            "&:hover": { bgcolor: alpha(arrowColor, 0.24) },
            "&.Mui-focusVisible": { outline: `2px solid ${alpha(arrowColor, 0.5)}`, outlineOffset: 1 },
          }}
        >
          {side === "left" ? <ChevronLeftIcon sx={{ fontSize: 22 }} /> : <ChevronRightIcon sx={{ fontSize: 22 }} />}
        </IconButton>
      </Box>
    );
  };

  return (
    <Box sx={{ position: "relative", flex: 1, minWidth: 0, display: "flex", alignSelf: "stretch" }} data-testid={testId}>
      {edge("left")}
      <Box
        ref={ref}
        sx={{
          display: "flex",
          alignItems: "center",
          gap,
          flex: 1,
          minWidth: 0,
          overflowX: "auto",
          scrollbarWidth: "none",
          "&::-webkit-scrollbar": { display: "none" },
        }}
      >
        {children}
      </Box>
      {edge("right")}
    </Box>
  );
}
