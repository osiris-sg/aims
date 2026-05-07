"use client";

import React from "react";
import { useOrganization } from "../context/OrganizationContext";
import { Box, Typography, Alert, Tabs, Tab } from "@mui/material";
import { useRouter, usePathname } from "next/navigation";
import { ROUTES } from "@/routes";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { organization, isLoaded } = useOrganization();
  const router = useRouter();
  const pathname = usePathname();

  // Show loading while checking organization
  if (!isLoaded) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography>Loading...</Typography>
      </Box>
    );
  }

  // Check if user is OsirisAdmin
  const isOsirisAdmin = organization?.name === "osiris-platform";

  if (!isOsirisAdmin) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">Access Denied. Only OsirisAdmin users can access this section.</Alert>
      </Box>
    );
  }

  // Navigation tabs configuration
  const adminTabs = [
    { label: "Dashboard", value: "/portal/admin", route: "/portal/admin" },
    { label: "Organizations", value: "/portal/admin/organizations", route: ROUTES.ORGANIZATIONS },
    { label: "Assets", value: "/portal/admin/assets", route: ROUTES.ADMIN_ASSETS },
    { label: "Inventory", value: "/portal/admin/inventory", route: ROUTES.ADMIN_INVENTORY },
    { label: "Customers", value: "/portal/admin/customers", route: ROUTES.ADMIN_CUSTOMERS },
    { label: "Documents", value: "/portal/admin/documents", route: ROUTES.ADMIN_DOCUMENTS },
    { label: "Document Templates", value: "/portal/admin/document-templates", route: "/portal/admin/document-templates" },
    { label: "Projects", value: "/portal/admin/projects", route: ROUTES.ADMIN_PROJECTS },
    { label: "Users", value: "/portal/admin/users", route: ROUTES.ADMIN_USERS },
    { label: "Roles", value: "/portal/admin/roles", route: ROUTES.ADMIN_ROLES },
    { label: "Audit Logs", value: "/portal/admin/audit", route: ROUTES.ADMIN_AUDIT_LOGS },
  ];

  const handleTabChange = (event: React.SyntheticEvent, newValue: string) => {
    router.push(newValue);
  };

  // Find current tab value - check for exact match first, then prefix match for nested routes
  const currentTab = adminTabs.find((tab) => pathname === tab.route)?.value
    || adminTabs.find((tab) => tab.route !== "/portal/admin" && pathname.startsWith(tab.route))?.value
    || "/portal/admin";

  return (
    <Box sx={{ p: 8, height: "100%", width: "100%", display: "flex", flexDirection: "column" }}>
      <Box sx={{ mb: 3, borderBottom: 1, borderColor: "divider", pb: 2 }}>
        <Typography variant="h4" sx={{ fontWeight: "bold", color: "primary.main" }}>
          OsirisAdmin Control Panel
        </Typography>
        <Typography variant="subtitle1" sx={{ color: "text.secondary", mt: 1 }}>
          Cross-Organization Management Dashboard
        </Typography>
      </Box>

      {/* Admin Navigation Tabs */}
      <Box sx={{ mb: 3 }}>
        <Tabs
          value={currentTab}
          onChange={handleTabChange}
          variant="scrollable"
          scrollButtons="auto"
          sx={{
            "& .MuiTab-root": {
              textTransform: "none",
              fontWeight: 500,
              fontSize: "0.9rem",
            },
            "& .Mui-selected": {
              color: "primary.main",
            },
            "& .MuiTabs-indicator": {
              backgroundColor: "primary.main",
            },
          }}
        >
          {adminTabs.map((tab) => (
            <Tab key={tab.value} label={tab.label} value={tab.value} />
          ))}
        </Tabs>
      </Box>
      <Box sx={{ flex: 1, height: "100%", width: "100%" }}>{children}</Box>
    </Box>
  );
}
