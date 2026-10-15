"use client";

// The strip that sits on top of the dashboard: AIMEE's face, a greeting and
// an "Ask AIMEE" pill. Pressing the face or sending a line opens AIMEE over
// the dashboard with a reveal that grows out of the face.

import React, { useRef, useState } from "react";
import { Box, IconButton, InputBase, Stack, Typography } from "@mui/material";
import ArrowUpwardRoundedIcon from "@mui/icons-material/ArrowUpwardRounded";
import { useUser } from "@clerk/nextjs";
import AimeeFace, { type AimeeMood } from "./AimeeFace";
import { openAimee } from "./homeView";

export default function AimeeBar() {
  const { user } = useUser();
  const faceRef = useRef<HTMLButtonElement | null>(null);
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const first = user?.firstName || "";
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const mood: AimeeMood = focused && text.trim() ? "listening" : "idle";

  const originOf = (el: HTMLElement | null) => {
    const r = el?.getBoundingClientRect();
    return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : {};
  };
  const open = (prompt?: string) => {
    openAimee({ ...originOf(faceRef.current), prompt: prompt?.trim() || undefined });
    setText("");
  };

  return (
    <Box
      data-tour="aimee-bar"
      sx={{
        // Same gutters and max width as the dashboard cards below it.
        mx: "auto",
        width: { xs: "calc(100% - 32px)", md: "calc(100% - 64px)" },
        maxWidth: "var(--page-max-width)",
        mt: { xs: "5rem", md: 2.5 },
        px: { xs: 1.5, md: 2 },
        py: { xs: 1.5, md: 1.5 },
        borderRadius: 4,
        border: "1px solid",
        borderColor: "divider",
        display: "flex",
        alignItems: "center",
        gap: { xs: 1.5, md: 2 },
        flexWrap: { xs: "wrap", md: "nowrap" },
        position: "relative",
        overflow: "hidden",
        bgcolor: "background.paper",
        backgroundImage: (t) =>
          t.palette.mode === "dark"
            ? "radial-gradient(900px 140px at 8% 50%, rgba(85,233,255,0.14), transparent 60%)"
            : "radial-gradient(900px 140px at 8% 50%, rgba(85,233,255,0.22), transparent 60%)",
        boxShadow: (t) => (t.palette.mode === "dark" ? "0 6px 24px rgba(0,0,0,0.35)" : "0 6px 24px rgba(16,24,40,0.06)"),
      }}
    >
      {/* The face is the button. A soft ring breathes behind it as an invitation. */}
      <Box sx={{ position: "relative", flexShrink: 0 }}>
        <Box
          sx={{
            position: "absolute",
            inset: -6,
            borderRadius: "40%",
            border: "2px solid rgba(85,233,255,0.55)",
            animation: "aimeeRing 2.8s ease-out infinite",
            pointerEvents: "none",
            "@keyframes aimeeRing": {
              "0%": { transform: "scale(0.9)", opacity: 0.6 },
              "70%": { transform: "scale(1.25)", opacity: 0 },
              "100%": { transform: "scale(1.25)", opacity: 0 },
            },
            "@media (prefers-reduced-motion: reduce)": { animation: "none", opacity: 0 },
          }}
        />
        <Box
          component="button"
          ref={faceRef}
          type="button"
          onClick={() => open()}
          aria-label="Open AIMEE"
          data-tour="aimee-face"
          sx={{
            all: "unset",
            display: "block",
            cursor: "pointer",
            borderRadius: "40%",
            "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 4 },
          }}
        >
          <AimeeFace size={64} mood={mood} hover />
        </Box>
      </Box>

      <Box sx={{ minWidth: 0, flex: { xs: "1 1 160px", md: "0 1 auto" } }}>
        <Typography sx={{ fontSize: "0.68rem", fontWeight: 800, letterSpacing: "0.12em", color: "text.secondary" }}>AIMEE</Typography>
        <Typography noWrap sx={{ fontWeight: 700, fontSize: { xs: "1rem", md: "1.1rem" }, letterSpacing: "-0.01em" }}>
          {greet}{first ? `, ${first}` : ""}. What shall we do?
        </Typography>
        <Typography noWrap sx={{ fontSize: "0.8rem", color: "text.secondary", display: { xs: "none", sm: "block" } }}>
          Ask anything or say what you need. Drafts open on the side and wait for your OK.
        </Typography>
      </Box>

      <Box
        onClick={() => !focused && open()}
        sx={{
          flex: { xs: "1 1 100%", md: 1 },
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          gap: 1,
          pl: 2,
          pr: 0.75,
          py: 0.5,
          borderRadius: 999,
          border: "1px solid",
          borderColor: focused ? "primary.main" : "divider",
          bgcolor: (t) => (t.palette.mode === "dark" ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.7)"),
          transition: "border-color .15s, box-shadow .15s",
          boxShadow: focused ? "0 0 0 3px rgba(85,233,255,0.25)" : "none",
        }}
      >
        <InputBase
          fullWidth
          value={text}
          placeholder="Ask AIMEE…"
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              open(text);
            }
          }}
          inputProps={{ "aria-label": "Ask AIMEE", "data-tour": "aimee-ask" }}
          sx={{ fontSize: "0.95rem" }}
        />
        <IconButton
          size="small"
          onClick={(e) => {
            e.stopPropagation();
            open(text);
          }}
          aria-label={text.trim() ? "Send to AIMEE" : "Open AIMEE"}
          sx={{
            bgcolor: "primary.main",
            color: "primary.contrastText",
            "&:hover": { bgcolor: "primary.dark" },
          }}
        >
          <ArrowUpwardRoundedIcon fontSize="small" />
        </IconButton>
      </Box>
    </Box>
  );
}
