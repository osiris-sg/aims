"use client";

import React from "react";
import { Box, Typography, Tabs, Tab } from "@mui/material";
import { useRouter, usePathname } from "next/navigation";

// Master Files hub — a route-based tab bar (mirrors the admin control panel)
// grouping the org's core master data: Customers, Suppliers, Products, Inventory.
// Each tab re-uses the existing standalone page via a thin wrapper route.
export default function MasterFilesLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const tabs = [
    { label: "Customers", value: "/portal/masterfiles/customers" },
    { label: "Suppliers", value: "/portal/masterfiles/suppliers" },
    { label: "Products", value: "/portal/masterfiles/products" },
    { label: "Inventory", value: "/portal/masterfiles/inventory" },
  ];

  const handleTabChange = (_event: React.SyntheticEvent, newValue: string) => {
    router.push(newValue);
  };

  const currentTab =
    tabs.find((tab) => pathname === tab.value)?.value ||
    tabs.find((tab) => pathname.startsWith(tab.value))?.value ||
    "/portal/masterfiles/customers";

  return (
    <Box sx={{ p: 8, minHeight: "100%", width: "100%", display: "flex", flexDirection: "column" }}>
      <Box sx={{ mb: 3, borderBottom: 1, borderColor: "divider", pb: 2 }}>
        <Typography variant="h4" sx={{ fontWeight: "bold", color: "primary.main" }}>
          Master Files
        </Typography>
        <Typography variant="subtitle1" sx={{ color: "text.secondary", mt: 1 }}>
          Manage customers, suppliers, products and inventory
        </Typography>
      </Box>

      <Box sx={{ mb: 3 }}>
        <Tabs
          value={currentTab}
          onChange={handleTabChange}
          variant="scrollable"
          scrollButtons="auto"
          sx={{
            "& .MuiTab-root": { textTransform: "none", fontWeight: 500, fontSize: "0.9rem" },
            "& .Mui-selected": { color: "primary.main" },
            "& .MuiTabs-indicator": { backgroundColor: "primary.main" },
          }}
        >
          {tabs.map((tab) => (
            <Tab key={tab.value} label={tab.label} value={tab.value} />
          ))}
        </Tabs>
      </Box>

      <Box sx={{ flex: 1, width: "100%" }}>{children}</Box>
    </Box>
  );
}
