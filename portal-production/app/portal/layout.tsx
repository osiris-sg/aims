"use client";
import React, { useEffect, useState } from "react";
import styles from "./layout.module.scss";
import { Box } from "@mui/material";
import DesktopSideBar from "@/components/Sidebar/DestopSideBar";
import AppNavbar from "@/components/Appnavbar";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { OrganizationProvider } from "./context/OrganizationContext";
import { ConfigurationProvider } from "./context/ConfigurationContext";
import { SidebarProvider } from "@/components/Sidebar/SidebarContext";
import { useThemeMode } from "@/contexts/ThemeModeContext";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import FieldOnlyGuard from "./components/FieldOnlyGuard";
import OrgSwitcher from "@/components/OrgSwitcher";
import ViewingAsBanner from "@/components/ViewingAsBanner";

interface Props {
  children: React.ReactNode;
}
export default function Layout(props: Props) {
  const { children } = props;
  const pathname = usePathname();
  const router = useRouter();
  const { mode } = useThemeMode();
  const { isLoaded, isSignedIn } = useAuth();

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
          <SidebarProvider>
            <Box
              className={styles.PORTAL_LAYOUT}
              sx={{
                bgcolor: "background.default",
                minHeight: "100vh",
              }}
            >
              <PortalChrome isDocumentPage={isDocumentPage} />

              <Box
                sx={{
                  flexGrow: 1,
                  width: "100%",
                  display: "flex",
                  flexDirection: "column",
                  // Document editor pages are viewport-locked (Xero-style):
                  // this column owns exactly one viewport height and the
                  // editor's inner regions scroll — the page itself never
                  // scrolls, whatever the monitor size. Other pages keep
                  // normal page scroll.
                  height: isDocumentPage ? "100dvh" : "100%",
                  // overflow auto (not hidden): if a very short screen can't fit
                  // the editor's minimum chrome, it scrolls instead of trapping
                  // controls below the fold.
                  ...(isDocumentPage && { minHeight: 0, overflow: "auto" }),
                }}
              >
                {/* Admin-only chrome — both components self-hide for non-admins. */}
                <ViewingAsBanner />
                {/* OrgSwitcher owns its own padded row and returns null for
                    non-admins — no empty strip on any page. Hidden entirely on
                    document pages (viewport-locked editor); admins switch org
                    from list pages, ViewingAsBanner still shows everywhere. */}
                {!isDocumentPage && <OrgSwitcher />}
                {children}
              </Box>
              <ToastContainer position="top-right" autoClose={3000} hideProgressBar={false} newestOnTop closeOnClick rtl={false} pauseOnFocusLoss draggable pauseOnHover theme={mode} />
            </Box>
          </SidebarProvider>
        </ConfigurationProvider>
      </FieldOnlyGuard>
    </OrganizationProvider>
  );
}

// Sidebar + navbar: always the regular chrome. Editor-first mode used to swap
// in the compact DocumentSidebar on editor pages; that context switch was
// dropped (guru, 2026-07-13) — the normal sidebar + navbar stay everywhere in
// both modes. (isDocumentPage kept in the signature for call-site stability.)
function PortalChrome({ isDocumentPage: _isDocumentPage }: { isDocumentPage: boolean }) {
  return (
    <>
      <DesktopSideBar />
      <AppNavbar />
    </>
  );
}
