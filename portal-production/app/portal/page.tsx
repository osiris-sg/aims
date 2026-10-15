"use client";
import DashboardOverview from "@/components/Dashboard/DashboardOverview";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Box } from "@mui/material";
import { useOrganizationFeatures } from "./hooks/useOrganizationFeatures";
import { HOME_VIEW_EVENT, closeAimee, openAimee, readHomeView, type AimeeOpenDetail } from "./chat/homeView";
import ChatHome from "./chat/ChatHome";
import AimeeBar from "./chat/AimeeBar";

// Landing page. Every org sees the dashboard. Orgs with enableAimsChat also
// get AIMEE on top of it: a strip with her face and an "Ask AIMEE" pill.
// Pressing either opens the assistant over the dashboard with a circular
// reveal that grows out of the face; "Dashboard" in its header shrinks it back.
type Phase = "dashboard" | "opening" | "aimee" | "closing";
const REVEAL_MS = 620;

export default function Page() {
  const { isAimsChatEnabled, isLoading } = useOrganizationFeatures();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase | null>(null);
  const [origin, setOrigin] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [prompt, setPrompt] = useState<string | undefined>();
  const timer = useRef<number | null>(null);
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current = !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    // Deep links open AIMEE straight away: ?chat=<id> (a conversation) or
    // ?aimee=1 (the face in the top bar, pressed on another page).
    const q = new URLSearchParams(window.location.search);
    const wantsAimee = !!q.get("chat") || q.get("aimee") === "1";
    if (wantsAimee) openAimee({ instant: true });
    else setPhase(readHomeView() === "aimee" ? "aimee" : "dashboard");

    const onChange = (e: Event) => {
      const d = (e as CustomEvent<AimeeOpenDetail>).detail;
      if (timer.current) window.clearTimeout(timer.current);
      if (d.view === "aimee") {
        setPrompt(d.prompt);
        if (d.instant || reduced.current) {
          setPhase("aimee");
          return;
        }
        setOrigin({ x: d.x ?? window.innerWidth / 2, y: d.y ?? window.innerHeight / 2 });
        setPhase("opening");
        timer.current = window.setTimeout(() => setPhase("aimee"), REVEAL_MS);
      } else {
        if (reduced.current) {
          setPhase("dashboard");
          return;
        }
        setPhase((p) => (p === "aimee" || p === "opening" ? "closing" : p));
        timer.current = window.setTimeout(() => setPhase("dashboard"), REVEAL_MS);
      }
    };
    window.addEventListener(HOME_VIEW_EVENT, onChange);
    return () => {
      window.removeEventListener(HOME_VIEW_EVENT, onChange);
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  const close = useCallback(() => {
    // Drop ?chat= / ?aimee= so a reload lands on the dashboard.
    router.replace("/portal", { scroll: false });
    closeAimee();
  }, [router]);

  if (isLoading || phase === null) return null;
  if (!isAimsChatEnabled) return <DashboardOverview />;

  const aimeeShown = phase !== "dashboard";
  const clip = phase === "opening" ? "aimeeOpen" : phase === "closing" ? "aimeeClose" : undefined;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {phase !== "aimee" && (
        <>
          <AimeeBar />
          <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", "& > div:first-of-type": { pt: 2 } }}>
            <DashboardOverview />
          </Box>
        </>
      )}

      {aimeeShown && (
        <Box
          sx={{
            position: "fixed",
            inset: 0,
            zIndex: (t) => t.zIndex.appBar - 1,
            pointerEvents: "none",
            "--ax": `${origin.x}px`,
            "--ay": `${origin.y}px`,
            clipPath: phase === "aimee" ? "none" : `circle(0px at var(--ax) var(--ay))`,
            animation: clip ? `${clip} ${REVEAL_MS}ms cubic-bezier(.65,0,.35,1) forwards` : "none",
            "@keyframes aimeeOpen": {
              from: { clipPath: "circle(0px at var(--ax) var(--ay))" },
              to: { clipPath: "circle(160vmax at var(--ax) var(--ay))" },
            },
            "@keyframes aimeeClose": {
              from: { clipPath: "circle(160vmax at var(--ax) var(--ay))" },
              to: { clipPath: "circle(0px at var(--ax) var(--ay))" },
            },
          }}
        >
          <Box sx={{ position: "absolute", top: { xs: 64, md: 52 }, left: 0, right: 0, bottom: 0, pointerEvents: "auto", bgcolor: "background.default" }}>
            <ChatHome onClose={close} initialPrompt={prompt} />
          </Box>
        </Box>
      )}
    </Box>
  );
}
