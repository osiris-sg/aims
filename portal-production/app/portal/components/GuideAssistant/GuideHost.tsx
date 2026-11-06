"use client";

// Round BL — runs a Guide walkthrough started from outside the ✦ Guide bubble (AIMEE's start_walkthrough tool, or
// any button calling startGuide(id)). Same engine as the bubble (TourOverlay + the guides.ts registry); mounted once
// in the portal layout. Full AIMEE closes first so the tour has the screen; the side panel folds to its tab itself.

import React, { useEffect, useState } from "react";
import TourOverlay from "./TourOverlay";
import { getGuide, type Guide } from "./guides";
import { GUIDE_EVENT } from "@/app/portal/shipments/_components/aimee/bridge";
import { closeAimee, readHomeView } from "@/app/portal/chat/homeView";

/** stayOnPage: /preview only — the steps' routes are dropped (the preview renders the same screens elsewhere). */
export default function GuideHost({ stayOnPage = false }: { stayOnPage?: boolean }) {
  const [guide, setGuide] = useState<Guide | null>(null);
  useEffect(() => {
    const onStart = (e: Event) => {
      const g = getGuide((e as CustomEvent<{ guideId: string }>).detail?.guideId ?? "");
      if (!g) return;
      if (readHomeView() === "aimee") closeAimee();
      setGuide(stayOnPage ? { ...g, steps: g.steps.map((st) => ({ ...st, route: undefined })) } : g);
    };
    window.addEventListener(GUIDE_EVENT, onStart);
    return () => window.removeEventListener(GUIDE_EVENT, onStart);
  }, [stayOnPage]);
  if (!guide) return null;
  return <TourOverlay key={guide.id} guide={guide} onClose={() => setGuide(null)} />;
}
