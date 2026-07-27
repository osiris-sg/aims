"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Button, IconButton, Paper, Stack, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import CheckIcon from "@mui/icons-material/Check";
import TouchAppIcon from "@mui/icons-material/TouchApp";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import CircularProgress from "@mui/material/CircularProgress";
import { usePathname, useRouter } from "next/navigation";
import type { Guide } from "./guides";

// Spotlight walkthrough player. For each step it (1) navigates to the step's
// route if needed, (2) polls for the anchor element, (3) dims the rest of the
// screen with a box-shadow cutout and shows an explanation card next to the
// element.
//
// Step behaviours:
// - `advanceOn: 'click'` — the step completes when the user actually clicks
//   the highlighted element (the real action, e.g. "Create Delivery Order"),
//   so the tour continues INTO the flow instead of ending at a description.
// - `patient: true` — no timeout: the step quietly waits (with a small pill)
//   until its element appears. Used after a click-through, where pickers or a
//   page load may sit between the click and the next anchored element.
// - Steps without a selector — or non-patient steps whose element never
//   appears — render as a centered explanation card, so a guide never
//   dead-ends when a screen changes.

const FIND_TIMEOUT_MS = 5000;
const POLL_MS = 200;
const CARD_WIDTH = 340;
const PAD = 6; // spotlight padding around the target

export default function TourOverlay({ guide, onClose }: { guide: Guide; onClose: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [gaveUp, setGaveUp] = useState(false);
  const searchStartRef = useRef<number>(Date.now());
  const boundElRef = useRef<HTMLElement | null>(null);
  const advanceHandlerRef = useRef<(() => void) | null>(null);

  const step = guide.steps[stepIndex];
  const isLast = stepIndex === guide.steps.length - 1;

  // Navigate to the step's route when it differs from where we are.
  useEffect(() => {
    if (step.route && pathname !== step.route) router.push(step.route);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex]);

  // Track the anchor element. Runs continuously while the step is active so the
  // spotlight follows layout shifts, scrolling and late-mounting elements.
  useEffect(() => {
    setRect(null);
    setGaveUp(false);
    searchStartRef.current = Date.now();

    const unbindClick = () => {
      if (boundElRef.current && advanceHandlerRef.current) {
        boundElRef.current.removeEventListener("click", advanceHandlerRef.current, true);
      }
      boundElRef.current = null;
      advanceHandlerRef.current = null;
    };

    if (!step.selector) return;

    let scrolled = false;
    const tick = () => {
      const el = document.querySelector(step.selector!) as HTMLElement | null;
      if (el) {
        if (!scrolled) {
          scrolled = true;
          el.scrollIntoView({ block: "center", behavior: "smooth" });
        }
        setRect(el.getBoundingClientRect());
        setGaveUp(false);
        // advance-on-click: bind (once per element instance) to the real
        // element so the user's actual click moves the tour forward. Capture
        // phase, so we advance even when the click immediately navigates.
        if (step.advanceOn === "click" && boundElRef.current !== el) {
          unbindClick();
          const handler = () => {
            unbindClick();
            window.setTimeout(() => setStepIndex((i) => Math.min(i + 1, guide.steps.length - 1)), 250);
          };
          el.addEventListener("click", handler, true);
          boundElRef.current = el;
          advanceHandlerRef.current = handler;
        }
      } else if (!step.patient && Date.now() - searchStartRef.current > FIND_TIMEOUT_MS) {
        setRect(null);
        setGaveUp(true);
      } else if (!el) {
        setRect(null);
      }
    };
    tick();
    const interval = window.setInterval(tick, POLL_MS);
    return () => {
      window.clearInterval(interval);
      unbindClick();
    };
    // pathname is a dependency so the search restarts after route changes land
  }, [stepIndex, step.selector, step.advanceOn, step.patient, pathname, guide.steps.length]);

  // Keyboard: Esc closes, arrows step.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" && !isLast && step.advanceOn !== "click") setStepIndex((i) => i + 1);
      if (e.key === "ArrowLeft" && stepIndex > 0) setStepIndex((i) => i - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isLast, stepIndex, onClose, step.advanceOn]);

  const anchored = !!rect && !!step.selector;
  const searching = !!step.selector && !rect && !gaveUp;

  // Card position: below the target when there's room, else above; clamped to
  // the viewport. Centered when there's no anchor.
  const cardStyle = useMemo(() => {
    if (!anchored || !rect) {
      return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" } as const;
    }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.min(Math.max(rect.left, 16), Math.max(16, vw - CARD_WIDTH - 16));
    const below = rect.bottom + PAD + 12;
    if (below + 220 < vh) return { top: below, left } as const;
    return { bottom: vh - rect.top + PAD + 12, left } as const;
  }, [anchored, rect]);

  // Patient steps show a small "waiting" pill instead of a card while the next
  // screen (editor, dialog result, …) is still loading.
  if (searching && step.patient) {
    return (
      <Paper
        elevation={8}
        sx={{
          position: "fixed",
          bottom: 24,
          left: "50%",
          transform: "translateX(-50%)",
          px: 2,
          py: 1,
          borderRadius: 99,
          display: "flex",
          alignItems: "center",
          gap: 1,
          zIndex: (t) => t.zIndex.modal + 11,
          bgcolor: "background.paper",
          backgroundImage: "none",
          border: 1,
          borderColor: "divider",
        }}
      >
        <CircularProgress size={14} />
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {guide.title} — waiting for the next screen… (step {stepIndex + 1} of {guide.steps.length})
        </Typography>
        <IconButton size="small" onClick={onClose} title="End tour" sx={{ ml: 0.5 }}>
          <CloseIcon sx={{ fontSize: 14 }} />
        </IconButton>
      </Paper>
    );
  }

  return (
    <>
      {/* Dimmer: spotlight cutout when anchored, full dim otherwise. The
          box-shadow trick leaves the highlighted element clickable. */}
      {anchored && rect ? (
        <Box
          sx={{
            position: "fixed",
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            borderRadius: 2,
            border: "2px solid",
            borderColor: "primary.main",
            boxShadow: "0 0 0 6000px rgba(0,0,0,0.55)",
            zIndex: (t) => t.zIndex.modal + 10,
            pointerEvents: "none",
            transition: "top .2s, left .2s, width .2s, height .2s",
          }}
        />
      ) : (
        !searching && (
          <Box
            sx={{
              position: "fixed",
              inset: 0,
              bgcolor: "rgba(0,0,0,0.55)",
              zIndex: (t) => t.zIndex.modal + 10,
            }}
            onClick={onClose}
          />
        )
      )}

      {/* Step card */}
      {!searching && (
        <Paper
          elevation={10}
          sx={{
            position: "fixed",
            ...cardStyle,
            width: { xs: "calc(100vw - 32px)", sm: CARD_WIDTH },
            maxWidth: CARD_WIDTH,
            p: 2,
            borderRadius: 2.5,
            zIndex: (t) => t.zIndex.modal + 11,
            bgcolor: "background.paper",
            backgroundImage: "none",
          }}
        >
          <Stack direction="row" alignItems="flex-start" justifyContent="space-between" gap={1}>
            <Stack direction="row" alignItems="center" gap={0.75} sx={{ minWidth: 0 }}>
              <AutoAwesomeIcon sx={{ color: "primary.main", fontSize: "1rem" }} />
              <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 600 }} noWrap>
                {guide.title} — step {stepIndex + 1} of {guide.steps.length}
              </Typography>
            </Stack>
            <IconButton size="small" onClick={onClose} sx={{ mt: -0.5, mr: -0.5 }} title="End tour">
              <CloseIcon fontSize="small" />
            </IconButton>
          </Stack>

          <Typography sx={{ fontWeight: 700, mt: 0.75 }}>{step.title}</Typography>
          <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5 }}>
            {step.body}
          </Typography>

          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 1.75 }}>
            <Button
              size="small"
              startIcon={<ArrowBackIcon />}
              disabled={stepIndex === 0}
              onClick={() => setStepIndex((i) => i - 1)}
            >
              Back
            </Button>
            {step.advanceOn === "click" && anchored ? (
              <Stack direction="row" alignItems="center" gap={0.5}>
                <TouchAppIcon sx={{ color: "primary.main", fontSize: "1.1rem" }} />
                <Typography variant="caption" sx={{ color: "primary.main", fontWeight: 600 }}>
                  Click the highlighted button
                </Typography>
              </Stack>
            ) : isLast ? (
              <Button size="small" variant="contained" endIcon={<CheckIcon />} onClick={onClose}>
                Done
              </Button>
            ) : (
              <Button
                size="small"
                variant="contained"
                endIcon={<ArrowForwardIcon />}
                onClick={() => setStepIndex((i) => i + 1)}
              >
                Next
              </Button>
            )}
          </Stack>
        </Paper>
      )}
    </>
  );
}
