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
import { usePathname } from "next/navigation";

interface Props {
  children: React.ReactNode;
}
export default function Layout(props: Props) {
  const { children } = props;
  const pathname = usePathname();

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
      <ConfigurationProvider>
        <SidebarProvider>
          <Box className={styles.PORTAL_LAYOUT} sx={isDocumentPage ? { bgcolor: "#f5f5f5", minHeight: "100vh" } : {}}>
            {isDocumentPage ? <DocumentSidebar /> : <DesktopSideBar />}
            {!isDocumentPage && <AppNavbar />}
            <Box sx={{ flexGrow: 1, height: "100%", width: "100%", display: "flex", flexDirection: "column" }}>{children}</Box>
            <ToastContainer position="top-right" autoClose={3000} hideProgressBar={false} newestOnTop closeOnClick rtl={false} pauseOnFocusLoss draggable pauseOnHover theme="light" />
          </Box>
        </SidebarProvider>
      </ConfigurationProvider>
    </OrganizationProvider>
  );
}
