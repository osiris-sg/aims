/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Round BL — /preview/shipments/*?aimee=<scenario>: the real AIMEE side panel (AimeeDock) on a fixture conversation
// (the `aimee` block = scripts/_bl-aimee-live.ts: real answers from a read-only run). Nothing is sent; a scenario with
// a walkthrough starts it after ?tour=1. GuideHost runs the tour as in the portal.

import React, { useEffect, useMemo } from "react";
import AimeeDock, { type DockChat } from "@/app/portal/shipments/_components/aimee/AimeeDock";
import GuideHost from "@/app/portal/components/GuideAssistant/GuideHost";
import { setAimeeContext, setAimeePreviewOn, startGuide } from "@/app/portal/shipments/_components/aimee/bridge";

export default function PreviewDock({ scenario }: { scenario: any }) {
  useMemo(() => setAimeePreviewOn(true), []);
  const chat: DockChat = useMemo(() => {
    const items = scenario?.items ?? [];
    const pending = items
      .filter((i: any) => i.buttons?.some((b: any) => b.data === "confirm:preview"))
      .map((i: any) => ({ id: "preview", kind: "shipments", summary: String(i.text ?? "").replace(/\n\nConfirm\?$/, ""), createdAt: i.at }));
    const noop = () => console.log("[preview aimee] nothing is sent");
    return { threads: [], threadsLoading: false, threadId: "w:preview", items, itemsLoading: false, pending, status: null, sending: false, error: null, send: noop, stop: noop, openThread: () => undefined, retry: noop, clearError: noop, reloadThreads: noop };
  }, [scenario]);
  useEffect(() => {
    const page = scenario?.page;
    if (page?.email) setAimeeContext("email", { email: page.email, view: page.view ?? "Dashboard" });
    const tour = new URLSearchParams(window.location.search).get("tour") === "1";
    const g = (scenario?.ui ?? []).find((u: any) => u.type === "guide");
    if (tour && g) window.setTimeout(() => startGuide(g.guideId), 600);
  }, [scenario]);
  return (
    <>
      <AimeeDock chat={chat} initialOpen />
      <GuideHost stayOnPage />
    </>
  );
}
