"use client";
import React, { useEffect, useState } from "react";
import styles from "./layout.module.scss";
import { Box } from "@mui/material";
import DesktopSideBar from "@/components/Sidebar/DestopSideBar";
import DocumentSidebar from "@/components/Sidebar/DocumentSidebar";
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

              <Box sx={{ flexGrow: 1, height: "100%", width: "100%", display: "flex", flexDirection: "column" }}>
                {/* Admin-only chrome — both components self-hide for non-admins. */}
                <ViewingAsBanner />
                <Box sx={{ display: "flex", justifyContent: "flex-end", px: 2, py: 1 }}>
                  <OrgSwitcher />
                </Box>
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

// Sidebar + navbar choice. The document editor pages normally swap in the
// compact DocumentSidebar, but when the enableDocumentListView feature flag
// is on we keep the regular DesktopSideBar + AppNavbar so the user stays
// anchored to the originating list view (matches the back-button behaviour
// in TabbedDocumentCreator).
function PortalChrome({ isDocumentPage }: { isDocumentPage: boolean }) {
  const { isDocumentListViewEnabled } = useOrganizationFeatures();
  const useDocumentChrome = isDocumentPage && !isDocumentListViewEnabled;
  return (
    <>
      {useDocumentChrome ? <DocumentSidebar /> : <DesktopSideBar />}
      {!useDocumentChrome && <AppNavbar />}
    </>
  );
}
