"use client";
import React, { useEffect, useState } from "react";
import styles from "./layout.module.scss";
import { Box, GlobalStyles } from "@mui/material";
import { ThemeProvider, useTheme } from "@mui/material/styles";
import { BaseThemeProvider } from "@/themes/BaseTheme";
import { buildDemoTheme, DEMO_CSS_VARS_LIGHT } from "./components/RoleHome/demoTheme";
import { DEMO_FONT } from "./components/RoleHome/demoFont";
import AppNavbar from "@/components/Appnavbar";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { OrganizationProvider } from "./context/OrganizationContext";
import { ConfigurationProvider } from "./context/ConfigurationContext";
import UiLangProvider from "@/i18n/UiLangProvider";
import OrgTimeZoneLoader from "@/components/OrgTimeZoneLoader";
import { SidebarProvider } from "@/components/Sidebar/SidebarContext";
import { useThemeMode } from "@/contexts/ThemeModeContext";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import FieldOnlyGuard from "./components/FieldOnlyGuard";
import ModuleRouteGuard from "./components/ModuleRouteGuard";
import GuideAssistant from "./components/GuideAssistant/GuideAssistant";
import GuideHost from "./components/GuideAssistant/GuideHost";
import AimeeDockHost from "./shipments/_components/aimee/AimeeDockHost";
import TopNavBar from "@/components/TopNav/TopNavBar";
import RoleTopBar from "./components/RoleHome/RoleTopBar";
import EnterAdvanceHost from "./components/EnterAdvanceHost";
import { useOrganizationFeatures } from "./hooks/useOrganizationFeatures";

interface Props {
  children: React.ReactNode;
}
export default function Layout(props: Props) {
  const { children } = props;
  const pathname = usePathname();
  const router = useRouter();
  const { mode } = useThemeMode();
  const { isLoaded, isSignedIn } = useAuth();
  // Embedded mode (?embed=1): a portal page shown inside the chat home's side
  // panel. No top bar, no mobile drawer, no Guide bubble: the host page has
  // them. Read from window, not useSearchParams, so no Suspense boundary is
  // needed around the whole portal.
  const [embed, setEmbed] = useState(false);
  useEffect(() => {
    try {
      setEmbed(new URLSearchParams(window.location.search).get("embed") === "1");
    } catch {
      /* no window */
    }
  }, [pathname]);

  // Bounce to sign-in once Clerk confirms there's no session. Without this,
  // a stale tab after sign-out sits on the portal showing 401s indefinitely.
  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      router.replace("/sign-in");
    }
  }, [isLoaded, isSignedIn, router]);

  // Debug logging
  console.log("Current pathname:", pathname);
  console.log("Path segments:", pathname?.split('/'));

  // Check if current route is a document editing/viewing page
  // Looking for patterns like:
  // /portal/documents/QO1/[id]/[documentId]
  // /portal/documents/DO/[id]/[documentId]
  // /portal/documents/edit/[type]/[id]
  // /portal/invoices/edit/[type]/[id]/[documentId]

  const pathSegments = pathname?.split('/').filter(Boolean) || [];
  const isDocumentPage =
    // Check for document view/edit pages: /portal/documents/[type]/[id]/[documentId]
    (pathSegments[0] === 'portal' &&
     pathSegments[1] === 'documents' &&
     pathSegments.length >= 5 &&
     !['create', 'templates'].includes(pathSegments[2])) ||
    // Check for document template edit: /portal/documents/edit/[type]/[id]
    (pathSegments[0] === 'portal' &&
     pathSegments[1] === 'documents' &&
     pathSegments[2] === 'edit' &&
     pathSegments.length >= 5) ||
    // Check for invoice edit: /portal/invoices/edit/[type]/[id]/[documentId]
    (pathSegments[0] === 'portal' &&
     pathSegments[1] === 'invoices' &&
     pathSegments[2] === 'edit' &&
     pathSegments.length >= 6);

  console.log("Is document page:", isDocumentPage);

  return (
    <OrganizationProvider>
      <FieldOnlyGuard>
        <ConfigurationProvider>
          {/* Default dates follow the org's time zone (helpers/orgToday). */}
          <OrgTimeZoneLoader />
          {/* Round AZ: EN / 日本語 (SHIPMENTS orgs; everyone else English). */}
          <UiLangProvider>
          <SidebarProvider>
            <OrgTheme>
            <Box
              className={styles.PORTAL_LAYOUT}
              sx={{
                bgcolor: "background.default",
                minHeight: "100vh",
              }}
            >
              {!embed && <PortalChrome isDocumentPage={isDocumentPage} />}

              <Box
                sx={{
                  flexGrow: 1,
                  width: "100%",
                  display: "flex",
                  flexDirection: "column",
                  // Document pages scroll like every other page (guru
                  // 2026-09-03, Xero-style: the PAGE scrolls, the items table
                  // does not have its own inner scrollbar).
                  height: "100%",
                }}
              >
                {!embed && <PortalTopBar />}
                {/* A page renders only when its module is on for the org being viewed (round Y). */}
                <ModuleRouteGuard>{children}</ModuleRouteGuard>
              </Box>
              {/* AIMS Guide bubble (bottom-right) — orgs without AIMEE only (round BM). */}
              {!embed && <GuideBubble />}
              {/* Round BL: Guide walkthroughs started from AIMEE (the same engine as the bubble). */}
              {!embed && <GuideHost />}
              {/* Round BL: the AIMEE side panel — orgs with the SHIPMENTS module and AIMEE on only (renders nothing elsewhere). */}
              {!embed && <AimeeDockHost />}
              {/* Enter walks forms field by field, like the legacy accounting software (guru 2026-11-08). */}
              <EnterAdvanceHost />
              <ToastContainer position="top-right" autoClose={3000} hideProgressBar={false} newestOnTop closeOnClick rtl={false} pauseOnFocusLoss draggable pauseOnHover theme={mode} />
            </Box>
            </OrgTheme>
          </SidebarProvider>
          </UiLangProvider>
        </ConfigurationProvider>
      </FieldOnlyGuard>
    </OrganizationProvider>
  );
}

// Org app-theme overlay. An org with enableRoleHome wears the role-home look
// on EVERY page (guru 2026-11-06): the same components, different tokens —
// typeface, page and card surfaces, pill buttons, indigo/teal accents. Every
// other org gets the theme it always had, through the same provider, so the
// tree is identical either way. The pre-overlay theme is handed down through
// BaseThemeProvider for paper documents, which must print the same in any org.
function OrgTheme({ children }: { children: React.ReactNode }) {
  const { isRoleHomeEnabled } = useOrganizationFeatures();
  const outer = useTheme();
  const theme = React.useMemo(() => (isRoleHomeEnabled ? buildDemoTheme(outer) : outer), [isRoleHomeEnabled, outer]);
  const light = outer.palette.mode === "light";
  return (
    <BaseThemeProvider value={isRoleHomeEnabled ? outer : null}>
      <ThemeProvider theme={theme}>
        {isRoleHomeEnabled && (
          <GlobalStyles
            styles={{
              // Plain (non-MUI) text and the page behind the app.
              body: { fontFamily: DEMO_FONT, ...(light ? { backgroundColor: theme.palette.background.default, color: theme.palette.text.primary } : {}) },
              // --app-font: read by the few places that name a typeface
              // themselves (editor fields, list-page titles). Both modes.
              ":root": { "--app-font": DEMO_FONT },
              // The CSS custom properties pages read directly (globals.css).
              ...(light ? { ":root[data-theme='light']": DEMO_CSS_VARS_LIGHT } : {}),
            }}
          />
        )}
        {children}
      </ThemeProvider>
    </BaseThemeProvider>
  );
}

// Desktop top bar. Orgs with enableRoleHome get the role-home bar (white,
// role-filtered menus, profile chip with the role switcher); everyone else
// keeps the Xero-style dark bar. Same modules, routes and permissions either
// way — only the presentation differs. While the flags are still loading the
// normal bar shows, exactly as it always has, so no other org sees a change.
function PortalTopBar() {
  const { isRoleHomeEnabled } = useOrganizationFeatures();
  return isRoleHomeEnabled ? <RoleTopBar /> : <TopNavBar />;
}

// Sidebar + navbar: always the regular chrome. Editor-first mode used to swap
// in the compact DocumentSidebar on editor pages; that context switch was
// dropped (guru, 2026-07-13) — the normal sidebar + navbar stay everywhere in
// both modes. (isDocumentPage kept in the signature for call-site stability.)
function PortalChrome({ isDocumentPage: _isDocumentPage }: { isDocumentPage: boolean }) {
  // Desktop navigation is the Xero-style top bar (guru 2026-08-30, global —
  // the left rail is retired). AppNavbar remains the mobile hamburger bar.
  return <AppNavbar />;
}

// Round BM: the ✦ Guide bubble shows only on orgs WITHOUT AIMEE. Where AIMEE is on (enableAimsChat) it is hidden
// everywhere: AIMEE answers "how do I", opens the screen and starts the same walkthroughs (GuideHost). Switching
// AIMEE on for an org hides the bubble there; switching it off brings it back.
function GuideBubble() {
  const { isAimsChatEnabled, isLoading } = useOrganizationFeatures();
  if (isLoading || isAimsChatEnabled) return null;
  return <GuideAssistant />;
}
