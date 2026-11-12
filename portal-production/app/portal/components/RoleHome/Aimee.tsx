"use client";

// The mock-up's AIMEE, ported as drawn (ui-roles-demo AimeeBot.jsx /
// AimeeRobot.jsx + the keyframes in App.css): a white shell with a dark green
// screen and two pale eyes that look around and blink. `AimeeBot` is the head
// for the top bar; `AimeeRobot` is the full figure for the assistant panel,
// whose head tilts and arms wave now and then.
//
// Only the drawing is the mock-up's — pressing either one opens the real AIMEE.

import * as React from "react";
import { GlobalStyles } from "@mui/material";

/** The mock-up's animation rules, mounted once by whoever draws an AIMEE. */
export function AimeeKeyframes() {
  return (
    <GlobalStyles
      styles={{
        ".aimee-look": { animation: "aimee-look 7s ease-in-out infinite" },
        ".aimee-blink": { transformBox: "fill-box", transformOrigin: "center", animation: "aimee-blink 4.2s ease-in-out infinite" },
        "@keyframes aimee-look": {
          "0%, 12%": { transform: "translate(0, 0)" },
          "18%, 32%": { transform: "translate(-12px, -2px)" },
          "38%, 50%": { transform: "translate(0, 0)" },
          "56%, 70%": { transform: "translate(12px, 3px)" },
          "76%, 86%": { transform: "translate(3px, -6px)" },
          "92%, 100%": { transform: "translate(0, 0)" },
        },
        "@keyframes aimee-blink": {
          "0%, 44%, 50%, 92%, 100%": { transform: "scaleY(1)" },
          "47%, 95%": { transform: "scaleY(0.1)" },
        },
        ".ar-head": { transformBox: "view-box", transformOrigin: "60px 80px", animation: "ar-head 11s ease-in-out infinite" },
        ".ar-arm-l": { transformBox: "view-box", transformOrigin: "38px 89px", animation: "ar-arm-l 13s ease-in-out infinite" },
        ".ar-arm-r": { transformBox: "view-box", transformOrigin: "82px 89px", animation: "ar-arm-r 9s ease-in-out infinite" },
        "@keyframes ar-head": {
          "0%, 30%, 46%, 72%, 86%, 100%": { transform: "rotate(0deg)" },
          "35%, 41%": { transform: "rotate(-9deg)" },
          "76%": { transform: "rotate(5deg) translateY(-1px)" },
          "80%": { transform: "rotate(-3deg)" },
        },
        "@keyframes ar-arm-l": {
          "0%, 55%, 75%, 100%": { transform: "rotate(0deg)" },
          "59%, 67%": { transform: "rotate(55deg)" },
          "63%, 71%": { transform: "rotate(35deg)" },
        },
        "@keyframes ar-arm-r": {
          "0%, 18%, 30%, 100%": { transform: "rotate(0deg)" },
          "22%, 26%": { transform: "rotate(-30deg)" },
        },
        "@keyframes aims-rise": {
          from: { opacity: 0, transform: "translateY(10px)" },
          to: { opacity: 1, transform: "translateY(0)" },
        },
        ".aims-rise": { animation: "aims-rise 0.45s ease-out both" },
        // Respect reduced motion: the figure holds still.
        "@media (prefers-reduced-motion: reduce)": {
          ".aimee-look, .aimee-blink, .ar-head, .ar-arm-l, .ar-arm-r, .aims-rise": { animation: "none" },
        },
      }}
    />
  );
}

// Face palette shared with app/portal/chat/AimeeFace.tsx (the chat bar's
// robot) so the role-home bot is the same character: navy visor, cyan eyes.
const VISOR = "#0b1020";
const VISOR_TOP = "#1a2238";
const EYE = "#55e9ff";
const EYE_CORE = "#c8fbff";

export function AimeeBot({ size = 44 }: { size?: number }) {
  const id = React.useId();
  return (
    <svg width={size} height={size * 0.83} viewBox="0 0 115 96" aria-label="AIMEE assistant">
      <defs>
        <linearGradient id={`shell-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#E4E6E2" />
        </linearGradient>
        {/* Same face as the chat top bar's AimeeFace (guru 2026-11-12: "keep
            the body, just the colour and eyes"): navy visor, cyan glowing eyes. */}
        <linearGradient id={`screen-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={VISOR_TOP} />
          <stop offset="100%" stopColor={VISOR} />
        </linearGradient>
        <filter id={`glow-${id}`} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="2.6" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <rect x="4" y="4" width="107" height="88" rx="30" fill={`url(#shell-${id})`} stroke="#D9DEE8" strokeWidth="2.5" />
      <rect x="14" y="14" width="87" height="68" rx="24" fill={`url(#screen-${id})`} />
      <path d="M30 26 Q57 18 85 26" stroke="#fff" strokeOpacity="0.14" strokeWidth="3" strokeLinecap="round" fill="none" />
      <g className="aimee-look">
        <g className="aimee-blink" filter={`url(#glow-${id})`}>
          <rect x="34" y="34" width="18" height="24" rx="8" fill={EYE} />
          <rect x="63" y="34" width="18" height="24" rx="8" fill={EYE} />
          <rect x="37" y="37" width="12" height="18" rx="5" fill={EYE_CORE} opacity="0.9" />
          <rect x="66" y="37" width="12" height="18" rx="5" fill={EYE_CORE} opacity="0.9" />
        </g>
      </g>
    </svg>
  );
}

export function AimeeRobot({ size = 90 }: { size?: number }) {
  const id = React.useId();
  const shell = `url(#rshell-${id})`;
  return (
    <svg width={size} height={size * 1.15} viewBox="0 0 120 138" aria-label="AIMEE assistant" style={{ flexShrink: 0, filter: "drop-shadow(0 4px 6px rgba(0,0,0,.12))" }}>
      <defs>
        <linearGradient id={`rshell-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#E3E4DE" />
        </linearGradient>
        <linearGradient id={`rscreen-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={VISOR_TOP} />
          <stop offset="100%" stopColor={VISOR} />
        </linearGradient>
        <filter id={`rglow-${id}`} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="2.6" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <ellipse cx="60" cy="134" rx="30" ry="3.5" fill="#000" opacity="0.08" />
      <g className="ar-arm-l"><rect x="27" y="86" width="13" height="22" rx="6.5" fill={shell} stroke="#D6D7D1" /></g>
      <g className="ar-arm-r"><rect x="80" y="86" width="13" height="22" rx="6.5" fill={shell} stroke="#D6D7D1" /></g>
      <rect x="47" y="124" width="11" height="9" rx="4" fill={shell} stroke="#D6D7D1" />
      <rect x="62" y="124" width="11" height="9" rx="4" fill={shell} stroke="#D6D7D1" />
      <rect x="37" y="76" width="46" height="52" rx="14" fill={shell} stroke="#D6D7D1" />
      <path d="M60 122 v6" stroke="#D6D7D1" strokeWidth="2" />
      {/* Chest mark sits top-right of the body, not centred (guru 2026-11-12). */}
      <g transform="translate(69 84) scale(0.28)">
        <path d="M2 33 L16 4 L22 4 L36 33 L28 33 L19 13 L10 33 Z" fill="#26132B" />
        <path d="M27 1 v9 M22.5 5.5 h9" stroke="#1F8A8A" strokeWidth="3.4" strokeLinecap="round" />
      </g>
      <g className="ar-head">
        {/* Head only recoloured to the chat bar's AimeeFace (guru 2026-11-12:
            "keep the body, just the colour and eyes"). Body, arms, feet and
            the chest mark are untouched. */}
        {/* Small ears (guru 2026-11-12: "add the ears but make it smaller"). */}
        <rect x="9" y="33" width="8" height="18" rx="4" fill={VISOR} />
        <rect x="103" y="33" width="8" height="18" rx="4" fill={VISOR} />
        <rect x="14" y="6" width="92" height="72" rx="32" fill={shell} stroke="#D9DEE8" strokeWidth="1.5" />
        <rect x="23" y="15" width="74" height="54" rx="24" fill={`url(#rscreen-${id})`} />
        <path d="M36 25 Q60 18 84 25" stroke="#fff" strokeOpacity="0.14" strokeWidth="2.5" strokeLinecap="round" fill="none" />
        <g className="aimee-look">
          <g className="aimee-blink" filter={`url(#rglow-${id})`}>
            <rect x="39" y="30" width="16" height="21" rx="7" fill={EYE} />
            <rect x="65" y="30" width="16" height="21" rx="7" fill={EYE} />
            <rect x="42" y="33" width="10" height="15" rx="4" fill={EYE_CORE} opacity="0.9" />
            <rect x="68" y="33" width="10" height="15" rx="4" fill={EYE_CORE} opacity="0.9" />
          </g>
        </g>
      </g>
    </svg>
  );
}
