"use client";
import DashboardOverview from "@/components/Dashboard/DashboardOverview";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Box } from "@mui/material";
import { useOrganizationFeatures } from "./hooks/useOrganizationFeatures";
import { useConfiguration } from "./context/ConfigurationContext";
import { HOME_VIEW_EVENT, closeAimee, openAimee, readHomeView, type AimeeOpenDetail } from "./chat/homeView";
import ChatHome from "./chat/ChatHome";
import AimeeBar from "./chat/AimeeBar";

// Landing page. Every org sees the dashboard. Orgs with enableAimsChat also
// get AIMEE on top of it: a strip with her face and an "Ask AIMEE" pill.
// Pressing either opens the assistant over the dashboard with a circular
// reveal that grows out of the face; "Dashboard" in its header shrinks it back.
//
// The reveal is driven with the Web Animations API from a frame AFTER the
// assistant has mounted: a CSS animation on the same element starts its clock
// while React is still busy mounting the conversation, so it was a third of
// the way through before the first paint. The dashboard stays mounted (hidden)
// under AIMEE for the same reason: closing has nothing to build.
type Phase = "dashboard" | "opening" | "aimee" | "closing";
const REVEAL_MS = 640;

export default function Page() {
  const { isAimsChatEnabled, isLoading } = useOrganizationFeatures();
  const router = useRouter();
  const { loading: configLoading, isModuleEnabled } = useConfiguration();
  // A trade org (Shipments on, the generic Dashboard module off — ADH) lands on Shipments › Home, not the asset dashboard.
  const tradeHome = !configLoading && isModuleEnabled("SHIPMENTS") && !isModuleEnabled("DASHBOARD");
  useEffect(() => {
    if (!tradeHome) return;
    const q = new URLSearchParams(window.location.search);
    if (q.get("chat") || q.get("aimee") === "1") return;
    router.replace("/portal/shipments/dashboard");
  }, [tradeHome, router]);
  const [phase, setPhase] = useState<Phase | null>(null);
  const [prompt, setPrompt] = useState<string | undefined>();
  const origin = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const overlay = useRef<HTMLDivElement | null>(null);
  const anim = useRef<Animation | null>(null);
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current = !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    // Deep links open AIMEE straight away: ?chat=<id> (a conversation) or
    // ?aimee=1 (the face in the top bar, pressed on another page).
    const q = new URLSearchParams(window.location.search);
    const wantsAimee = !!q.get("chat") || q.get("aimee") === "1";
    // (The listener below is not registered yet, so the phase is set here too.)
    if (wantsAimee) {
      openAimee({ instant: true });
      setPhase("aimee");
    } else setPhase(readHomeView() === "aimee" ? "aimee" : "dashboard");

    const onChange = (e: Event) => {
      const d = (e as CustomEvent<AimeeOpenDetail>).detail;
      anim.current?.cancel();
      if (d.view === "aimee") {
        setPrompt(d.prompt);
        if (d.instant || reduced.current) {
          setPhase("aimee");
          return;
        }
        origin.current = { x: d.x ?? window.innerWidth / 2, y: d.y ?? window.innerHeight / 2 };
        setPhase("opening");
      } else {
        setPhase((p) => (p === "dashboard" ? p : reduced.current ? "dashboard" : "closing"));
      }
    };
    window.addEventListener(HOME_VIEW_EVENT, onChange);
    return () => {
      window.removeEventListener(HOME_VIEW_EVENT, onChange);
      anim.current?.cancel();
    };
  }, []);

  // Run the reveal once the overlay is on screen.
  useEffect(() => {
    if (phase !== "opening" && phase !== "closing") return;
    const el = overlay.current;
    const done = () => setPhase(phase === "opening" ? "aimee" : "dashboard");
    if (!el || typeof el.animate !== "function") {
      done();
      return;
    }
    const { x, y } = origin.current;
    const r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y)) + 40;
    const small = `circle(0px at ${x}px ${y}px)`;
    const big = `circle(${Math.round(r)}px at ${x}px ${y}px)`;
    el.style.clipPath = phase === "opening" ? small : big;
    let fallback = 0;
    const raf = window.requestAnimationFrame(() => {
      const a = el.animate(phase === "opening" ? [{ clipPath: small }, { clipPath: big }] : [{ clipPath: big }, { clipPath: small }], {
        duration: REVEAL_MS,
        easing: phase === "opening" ? "cubic-bezier(.2,.7,.2,1)" : "cubic-bezier(.6,0,.8,.4)",
        fill: "forwards",
      });
      anim.current = a;
      a.onfinish = () => {
        anim.current = null;
        done();
      };
      fallback = window.setTimeout(done, REVEAL_MS + 300);
    });
    return () => {
      window.cancelAnimationFrame(raf);
      if (fallback) window.clearTimeout(fallback);
    };
  }, [phase]);

  const close = useCallback(() => {
    // Drop ?chat= / ?aimee= so a reload lands on the dashboard.
    router.replace("/portal", { scroll: false });
    closeAimee();
  }, [router]);

  if (isLoading || phase === null || tradeHome) return null;
  if (!isAimsChatEnabled) return <DashboardOverview />;

  const aimeeShown = phase !== "dashboard";

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <Box
        aria-hidden={phase === "aimee"}
        sx={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, visibility: phase === "aimee" ? "hidden" : "visible" }}
      >
        <AimeeBar />
        <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", "& > div:first-of-type": { pt: 2 } }}>
          <DashboardOverview />
        </Box>
      </Box>

      {aimeeShown && (
        <Box
          ref={overlay}
          sx={{
            position: "fixed",
            inset: 0,
            zIndex: (t) => t.zIndex.appBar - 1,
            pointerEvents: "none",
            willChange: phase === "aimee" ? "auto" : "clip-path",
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
