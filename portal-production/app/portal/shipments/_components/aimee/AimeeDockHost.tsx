"use client";

// Round BL — mounts the AIMEE side panel on an org with the SHIPMENTS module AND AIMEE on (enableAimsChat), and
// registers the `aimee` payload useOperatorChat sends (the page in view, the walkthroughs this user may run, the
// conversation's scope); the panel steps aside while full AIMEE is open on the dashboard.
// Round BM: every other AIMEE org registers the walkthroughs only (no page, no scope) so its AIMEE can start
// Guide walkthroughs now that the ✦ button is hidden there. Since 2026-11-09 those orgs ALSO get the panel, quietly:
// no edge tab, the face still opens full AIMEE; the "Ask AIMEE" button (Finance Hub; the document editor's was retired 2026-11-13) opens it beside
// the page the user is on (guru: "open at the side while keeping the page open"). Orgs without AIMEE: nothing.

import React, { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useConfiguration } from "@/app/portal/context/ConfigurationContext";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import { useUserPermissions } from "@/app/portal/hooks/useUserPermissions";
import { useNavModules } from "@/components/TopNav/useNavModules";
import { HOME_VIEW_EVENT, readHomeView } from "@/app/portal/chat/homeView";
import { useOperatorChat } from "@/app/portal/chat/useOperatorChat";
import { LEGACY_MODULES, guideCatalog } from "@/app/portal/components/GuideAssistant/guides";
import AimeeDock from "./AimeeDock";
import { readAimeeContext, registerAimeePayload, scopeOf, setAimeeContext } from "./bridge";

function LiveDock({ quiet }: { quiet?: boolean }) {
  const router = useRouter();
  const { screens } = useNavModules();
  // The panel lives on other pages: no ?chat= in the URL; a screen AIMEE opens moves the page, the panel stays.
  const chat = useOperatorChat(screens, {
    urlSync: false,
    onUi: (e) => {
      if (e.type === "screen") router.push(e.path);
      return true;
    },
  });
  return <AimeeDock chat={chat} quiet={quiet} />;
}

export default function AimeeDockHost() {
  const pathname = usePathname();
  const { isAimsChatEnabled, isLoading } = useOrganizationFeatures();
  const { loading, modules, isModuleEnabled } = useConfiguration();
  if (isLoading || loading || !isAimsChatEnabled) return null;
  return <Gated pathname={pathname} modules={modules} shipments={isModuleEnabled("SHIPMENTS")} />;
}

function Gated({ pathname, modules, shipments }: { pathname: string | null; modules: Array<{ moduleCode: string; enabled: boolean }>; shipments: boolean }) {
  const { isModuleAllowed } = useUserPermissions();
  // The walkthroughs this user may run: the Guide's own rule (modules on for the org and allowed for the role).
  const guides = useMemo(() => {
    const codes = new Set(modules.filter((m) => m.enabled && !LEGACY_MODULES.has(m.moduleCode) && isModuleAllowed(m.moduleCode)).map((m) => m.moduleCode));
    return guideCatalog(codes).map((g) => ({ id: g.id, title: g.title }));
  }, [modules, isModuleAllowed]);

  useEffect(() => {
    registerAimeePayload(() => {
      // No page context here, but the quiet panel's conversations are still kept apart from full AIMEE's, so the
      // panel reopens on the same conversation next time.
      if (!shipments) return { page: null, guides, scope: readHomeView() === "aimee" ? undefined : "general" };
      const page = readAimeeContext();
      // Full AIMEE (the dashboard chat) keeps its own unscoped conversations.
      return { page: { ...(page ?? {}), path: page?.path ?? window.location.pathname }, guides, scope: readHomeView() === "aimee" ? undefined : scopeOf(page) };
    });
    return () => registerAimeePayload(null);
  }, [guides, shipments]);

  // An email card's context belongs to the page it was asked on.
  useEffect(() => {
    setAimeeContext("email", null);
  }, [pathname]);

  // Full AIMEE over the dashboard has the screen: the panel steps aside.
  const [full, setFull] = useState(false);
  useEffect(() => {
    const sync = () => setFull(readHomeView() === "aimee");
    sync();
    window.addEventListener(HOME_VIEW_EVENT, sync);
    return () => window.removeEventListener(HOME_VIEW_EVENT, sync);
  }, [pathname]);
  if (!pathname?.startsWith("/portal") || full) return null;
  return <LiveDock quiet={!shipments} />;
}
