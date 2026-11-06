"use client";

// Round BL — mounts the AIMEE side panel on an org with the SHIPMENTS module AND AIMEE on (enableAimsChat); renders
// nothing anywhere else, so no other org changes. Registers the `aimee` payload useOperatorChat sends for this org
// (the page in view, the walkthroughs this user may run, the conversation's scope) and hides the panel while full
// AIMEE is open on the dashboard.

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

function LiveDock() {
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
  return <AimeeDock chat={chat} />;
}

export default function AimeeDockHost() {
  const pathname = usePathname();
  const { isAimsChatEnabled, isLoading } = useOrganizationFeatures();
  const { loading, modules, isModuleEnabled } = useConfiguration();
  const on = !isLoading && !loading && isAimsChatEnabled && isModuleEnabled("SHIPMENTS");
  return on ? <Gated pathname={pathname} modules={modules} /> : null;
}

function Gated({ pathname, modules }: { pathname: string | null; modules: Array<{ moduleCode: string; enabled: boolean }> }) {
  const { isModuleAllowed } = useUserPermissions();
  // The walkthroughs this user may run: the Guide's own rule (modules on for the org and allowed for the role).
  const guides = useMemo(() => {
    const codes = new Set(modules.filter((m) => m.enabled && !LEGACY_MODULES.has(m.moduleCode) && isModuleAllowed(m.moduleCode)).map((m) => m.moduleCode));
    return guideCatalog(codes).map((g) => ({ id: g.id, title: g.title }));
  }, [modules, isModuleAllowed]);

  useEffect(() => {
    registerAimeePayload(() => {
      const page = readAimeeContext();
      // Full AIMEE (the dashboard chat) keeps its own unscoped conversations.
      return { page: { ...(page ?? {}), path: page?.path ?? window.location.pathname }, guides, scope: readHomeView() === "aimee" ? undefined : scopeOf(page) };
    });
    return () => registerAimeePayload(null);
  }, [guides]);

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
  return <LiveDock />;
}
