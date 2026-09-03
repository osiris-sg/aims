"use client";
import React, { useEffect, useState } from "react";
import styles from "./layout.module.scss";
import { Box } from "@mui/material";
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
import GuideAssistant from "./components/GuideAssistant/GuideAssistant";
import TopNavBar from "@/components/TopNav/TopNavBar";

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
                  // Document pages scroll like every other page (guru
                  // 2026-09-03, Xero-style: the PAGE scrolls, the items table
                  // does not have its own inner scrollbar).
                  height: "100%",
                }}
              >
                <TopNavBar />
                {children}
              </Box>
              {/* AIMS Guide bubble (bottom-right) — global for every org. */}
              <GuideAssistant />
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
  // Desktop navigation is the Xero-style top bar (guru 2026-08-30, global —
  // the left rail is retired). AppNavbar remains the mobile hamburger bar.
  return <AppNavbar />;
}
