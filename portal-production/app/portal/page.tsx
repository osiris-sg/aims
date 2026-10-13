"use client";
import DashboardOverview from "@/components/Dashboard/DashboardOverview";
import React, { useEffect, useState } from "react";
import { useOrganizationFeatures } from "./hooks/useOrganizationFeatures";
import { HOME_VIEW_EVENT, readHomeView, type HomeView } from "./chat/homeView";
import ChatHome from "./chat/ChatHome";

// Landing page. Chat-first orgs (enableAimsChat) open on the assistant, with
// the top-bar toggle switching to the classic dashboard; everyone else sees
// the dashboard as before.
export default function Page() {
  const { isAimsChatEnabled, isLoading } = useOrganizationFeatures();
  const [view, setView] = useState<HomeView | null>(null);
  useEffect(() => {
    const sync = () => setView(readHomeView());
    sync();
    window.addEventListener(HOME_VIEW_EVENT, sync);
    return () => window.removeEventListener(HOME_VIEW_EVENT, sync);
  }, []);
  if (isLoading || view === null) return null;
  if (isAimsChatEnabled && view === "chat") return <ChatHome />;
  return <DashboardOverview />;
}
