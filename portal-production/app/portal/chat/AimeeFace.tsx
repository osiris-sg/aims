"use client";

// AIMEE's face (guru 2026-10-15): a white robot head with a dark visor and
// two glowing cyan eyes, after the Eilik desk robot. The eyes blink, follow
// the pointer, and change with what AIMEE is doing: listening while the user
// types, scanning while it thinks, happy when the reply lands.
//
// One component for every size: the top bar (26px), the strip above the
// dashboard (72px), the assistant header (36px) and the welcome screen (104px).

import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { Box, useTheme } from "@mui/material";

export type AimeeMood = "idle" | "listening" | "thinking" | "happy" | "sad" | "asleep";

interface Props {
  size?: number;
  mood?: AimeeMood;
  /** Eyes follow the pointer anywhere on the page. */
  track?: boolean;
  /** Start with the eyes shut and open them a beat after mount. */
  wake?: boolean;
  /** Head tilts and lifts on hover (for faces that are buttons). */
  hover?: boolean;
  className?: string;
}

const EYE = { w: 14, h: 18, rx: 6, y: 41, lx: 29, rx2: 57 } as const;

export default function AimeeFace({ size = 48, mood = "idle", track = true, wake = false, hover = false, className }: Props) {
  const theme = useTheme();
  const dark = theme.palette.mode === "dark";
  const uid = useId().replace(/:/g, "");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const lookRef = useRef<SVGGElement | null>(null);
  const [awake, setAwake] = useState(!wake);
  const reduced = useMemo(() => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches, []);
  // Every face blinks on its own beat, so three of them never blink in unison.
  const blinkDelay = useMemo(() => -(Math.random() * 4).toFixed(2) + "s", []);

  useEffect(() => {
    if (!wake) return;
    const t = window.setTimeout(() => setAwake(true), 220);
    return () => window.clearTimeout(t);
  }, [wake]);

  // Pointer tracking: the eye group slides a few viewBox units toward the
  // pointer, eased by a CSS transition. Thinking and asleep ignore the pointer.
  useEffect(() => {
    if (!track || reduced || mood === "thinking" || mood === "asleep") {
      if (lookRef.current) lookRef.current.style.transform = "translate(0px, 0px)";
      return;
    }
    let raf = 0;
    let last: MouseEvent | null = null;
    const apply = () => {
      raf = 0;
      const el = rootRef.current;
      const g = lookRef.current;
      if (!el || !g || !last) return;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dx = last.clientX - cx;
      const dy = last.clientY - cy;
      const reach = 260;
      const nx = Math.max(-1, Math.min(1, dx / reach));
      const ny = Math.max(-1, Math.min(1, dy / reach));
      g.style.transform = `translate(${(nx * 5).toFixed(2)}px, ${(ny * 3.5).toFixed(2)}px)`;
    };
    const move = (e: MouseEvent) => {
      last = e;
      if (!raf) raf = window.requestAnimationFrame(apply);
    };
    const leave = () => {
      last = null;
      if (lookRef.current) lookRef.current.style.transform = "translate(0px, 0px)";
    };
    window.addEventListener("mousemove", move, { passive: true });
    document.documentElement.addEventListener("mouseleave", leave);
    return () => {
      window.removeEventListener("mousemove", move);
      document.documentElement.removeEventListener("mouseleave", leave);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [track, reduced, mood]);

  // Per-mood eye shape, applied as transforms so every change eases.
  const open = awake && mood !== "asleep";
  const eyeScale = !open ? "scaleY(0.06)" : mood === "listening" ? "scale(1.08, 1.22)" : mood === "happy" ? "translateY(-3px) scaleY(0.22)" : mood === "sad" ? "translateY(2px) scale(0.9, 0.72)" : "scale(1, 1)";
  const glow = mood === "thinking" || mood === "listening" ? 1 : mood === "sad" ? 0.5 : 0.85;

  const head = dark ? "#e4e8f0" : "#f7f8fb";
  const headEdge = dark ? "#b9c1d0" : "#d9dee8";
  const visor = "#0b1020";

  return (
    <Box
      ref={rootRef}
      className={className}
      aria-hidden
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        display: "inline-block",
        transition: "transform .35s cubic-bezier(.34,1.56,.64,1)",
        transform: mood === "happy" ? "rotate(-5deg)" : mood === "sad" ? "rotate(3deg) translateY(1px)" : "none",
        ...(hover && !reduced && { "&:hover": { transform: "rotate(-7deg) scale(1.08) translateY(-1px)" } }),
        "& .aimee-eyes": {
          transformBox: "fill-box",
          transformOrigin: "center",
          animation: open && !reduced ? `aimeeBlink-${uid} 4.4s ${blinkDelay} infinite` : "none",
        },
        "& .aimee-look": { transition: "transform .32s ease-out" },
        "& .aimee-eye": {
          transformBox: "fill-box",
          transformOrigin: "center",
          transition: "transform .28s cubic-bezier(.34,1.56,.64,1), opacity .25s",
          transform: eyeScale,
        },
        "& .aimee-scan": {
          animation: mood === "thinking" && !reduced ? `aimeeScan-${uid} 1.9s ease-in-out infinite` : "none",
        },
        "& .aimee-pulse": {
          animation: mood === "thinking" && !reduced ? `aimeePulse-${uid} 1.2s ease-in-out infinite` : "none",
        },
        "& .aimee-smile": { transition: "opacity .25s", opacity: mood === "happy" && open ? 1 : 0 },
        [`@keyframes aimeeBlink-${uid}`]: {
          "0%, 93%, 100%": { transform: "scaleY(1)" },
          "96%": { transform: "scaleY(0.08)" },
        },
        [`@keyframes aimeeScan-${uid}`]: {
          "0%, 100%": { transform: "translate(-4px, -2px)" },
          "50%": { transform: "translate(4px, -2px)" },
        },
        [`@keyframes aimeePulse-${uid}`]: {
          "0%, 100%": { opacity: 0.75 },
          "50%": { opacity: 1 },
        },
      }}
    >
      <svg viewBox="0 0 100 100" width={size} height={size} style={{ display: "block", overflow: "visible" }}>
        <defs>
          <linearGradient id={`head-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="1" stopColor={head} />
          </linearGradient>
          <linearGradient id={`visor-${uid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#1a2238" />
            <stop offset="1" stopColor={visor} />
          </linearGradient>
          <filter id={`glow-${uid}`} x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="2.6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id={`shadow-${uid}`} x="-20%" y="-20%" width="140%" height="150%">
            <feDropShadow dx="0" dy="2.5" stdDeviation="2.5" floodColor="#000" floodOpacity={dark ? 0.45 : 0.18} />
          </filter>
        </defs>

        {/* Head */}
        <rect x="4" y="6" width="92" height="88" rx="34" fill={`url(#head-${uid})`} stroke={headEdge} strokeWidth="1.5" filter={`url(#shadow-${uid})`} />
        {/* Visor */}
        <rect x="13" y="20" width="74" height="60" rx="26" fill={`url(#visor-${uid})`} />
        <path d="M24 30 Q50 22 76 30" stroke="#ffffff" strokeOpacity="0.14" strokeWidth="3" strokeLinecap="round" fill="none" />

        {/* Eyes: look (pointer) > scan (thinking) > blink > per-eye mood shape */}
        <g className="aimee-look" ref={lookRef}>
          <g className="aimee-scan">
            <g className="aimee-pulse" opacity={glow}>
              <g className="aimee-eyes" filter={`url(#glow-${uid})`}>
                <rect className="aimee-eye" x={EYE.lx} y={EYE.y} width={EYE.w} height={EYE.h} rx={EYE.rx} fill="#55e9ff" />
                <rect className="aimee-eye" x={EYE.rx2} y={EYE.y} width={EYE.w} height={EYE.h} rx={EYE.rx} fill="#55e9ff" />
                <rect className="aimee-eye" x={EYE.lx + 3} y={EYE.y + 3} width={EYE.w - 6} height={EYE.h - 6} rx={4} fill="#c8fbff" opacity="0.9" />
                <rect className="aimee-eye" x={EYE.rx2 + 3} y={EYE.y + 3} width={EYE.w - 6} height={EYE.h - 6} rx={4} fill="#c8fbff" opacity="0.9" />
              </g>
            </g>
            {/* Happy arcs sit where the eyes were */}
            <g className="aimee-smile" filter={`url(#glow-${uid})`} stroke="#9df3ff" strokeWidth="4.5" strokeLinecap="round" fill="none">
              <path d="M30 51 Q36 43 42 51" />
              <path d="M58 51 Q64 43 70 51" />
            </g>
          </g>
        </g>
      </svg>
    </Box>
  );
}
