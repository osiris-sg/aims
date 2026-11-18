"use client";

// Fixture-rendered top bar tab rows. The bars' real components need a signed-in org, so this renders the same
// pieces (NavTabsScroller, the same tab styling) around fixture tabs. Served only with PREVIEW_FIXTURES=1.

import React, { useMemo, useState } from "react";
import { Box, Button, ButtonBase, CssBaseline, IconButton, InputBase, Stack, Typography } from "@mui/material";
import { ThemeProvider, alpha } from "@mui/material/styles";
import HomeRoundedIcon from "@mui/icons-material/HomeRounded";
import SearchIcon from "@mui/icons-material/Search";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import lightTheme from "@/themes/lightTheme";
import darkTheme from "@/themes/darkTheme";
import NavTabsScroller from "@/components/TopNav/NavTabsScroller";

const SALES_TABS = ["Sales", "Quotation", "Sales Order", "Delivery Order", "Return Delivery Order", "Invoice", "Debit Note", "Credit Note", "Customer Statement", "Receipts", "Price List"];
const MODULES = ["Dashboard", "Sales", "Purchases", "Inventory", "Accounting", "Projects", "Deliveries", "Service Reports", "Assets", "Reports", "CRM", "Org Settings"];
const INK = "#1C1A33";

function OldScroll({ children, mask }: { children: React.ReactNode; mask: boolean }) {
  return (
    <Stack
      direction="row"
      alignItems="center"
      gap={0.25}
      sx={{
        flex: 1, minWidth: 0, overflowX: "auto", scrollbarWidth: "none", "&::-webkit-scrollbar": { display: "none" },
        ...(mask ? { pr: 3, maskImage: "linear-gradient(to right, black calc(100% - 28px), transparent)", WebkitMaskImage: "linear-gradient(to right, black calc(100% - 28px), transparent)" } : {}),
      }}
    >
      {children}
    </Stack>
  );
}

function SearchField({ dark, collapsible }: { dark: boolean; collapsible: boolean }) {
  const [open, setOpen] = useState(false);
  if (collapsible && !open)
    return (
      <IconButton size="small" aria-label="Search" onClick={() => setOpen(true)} data-testid="search-icon" sx={{ color: dark ? "text.primary" : INK, border: "1px solid", borderColor: dark ? alpha("#fff", 0.16) : "#E2E8F0" }}>
        <SearchIcon fontSize="small" />
      </IconButton>
    );
  return (
    <Stack direction="row" alignItems="center" gap={1} sx={{ width: 260, flexShrink: 0, px: 1.5, height: 36, borderRadius: 999, border: "1px solid", borderColor: dark ? alpha("#fff", 0.16) : "#E2E8F0" }}>
      <SearchIcon fontSize="small" sx={{ color: "text.secondary" }} />
      <InputBase autoFocus={collapsible} placeholder="Search anything" sx={{ fontSize: 14, flex: 1 }} onBlur={() => collapsible && setOpen(false)} />
    </Stack>
  );
}

export default function PreviewClient({ mode, before, search }: { mode: "light" | "dark"; before: boolean; search: boolean }) {
  const theme = useMemo(() => (mode === "dark" ? darkTheme : lightTheme), [mode]);
  const dark = mode === "dark";
  const barBg = dark ? theme.palette.background.paper : "#ffffff";
  const tab = (label: string, active = false) => (
    <Button key={label} size="small" sx={{ color: dark ? "text.primary" : INK, px: 1.25, py: 0.75, minHeight: 0, borderRadius: 3, whiteSpace: "nowrap", flexShrink: 0, textTransform: "none", fontSize: "0.875rem", fontWeight: active ? 500 : 400, bgcolor: active ? (dark ? alpha("#fff", 0.1) : "#EEF0F8") : "transparent", boxShadow: active ? "inset 0 -2px 0 #14B8A6" : "none" }}>
      {label}
    </Button>
  );
  const darkItem = (label: string) => (
    <Button key={label} size="small" endIcon={<KeyboardArrowDownIcon sx={{ fontSize: "1rem !important", opacity: 0.7 }} />} sx={{ color: "#FFFFFF", px: 1.5, height: 52, borderRadius: 0, whiteSpace: "nowrap", flexShrink: 0, fontSize: "0.8125rem", textTransform: "none" }}>
      {label}
    </Button>
  );
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ bgcolor: "background.default", minHeight: "100vh", flex: 1, minWidth: 0, width: "100%" }}>
        <Typography variant="caption" sx={{ display: "block", px: 2, pt: 1, color: "text.secondary" }}>
          Role-home bar, Sales level
        </Typography>
        <Stack direction="row" alignItems="center" gap={1.5} sx={{ height: 64, px: 2, bgcolor: barBg, borderBottom: "1px solid", borderColor: dark ? alpha("#fff", 0.08) : "#F1F5F9" }} data-testid="bar-role">
          <Typography sx={{ fontWeight: 800, fontSize: 18, color: dark ? "text.primary" : INK, flexShrink: 0 }}>AIMS</Typography>
          <Stack direction="row" alignItems="center" gap={0.25} sx={{ flex: 1, minWidth: 0, alignSelf: "stretch" }}>
            {before ? (
              <OldScroll mask>
                <IconButton size="small" sx={{ color: dark ? "text.primary" : INK, flexShrink: 0 }}><HomeRoundedIcon fontSize="small" /></IconButton>
                <ButtonBase sx={{ fontSize: "0.875rem", fontWeight: 600, color: dark ? "text.primary" : INK, px: 0.75, flexShrink: 0 }}>Sales</ButtonBase>
                <Box sx={{ width: "1px", height: 20, bgcolor: dark ? alpha("#fff", 0.16) : "#E2E6F0", mx: 0.5, flexShrink: 0 }} />
                {SALES_TABS.map((l, i) => tab(l, i === 1))}
              </OldScroll>
            ) : (
              <>
                <IconButton size="small" sx={{ color: dark ? "text.primary" : INK, flexShrink: 0 }}><HomeRoundedIcon fontSize="small" /></IconButton>
                <ButtonBase sx={{ fontSize: "0.875rem", fontWeight: 600, color: dark ? "text.primary" : INK, px: 0.75, flexShrink: 0 }}>Sales</ButtonBase>
                <Box sx={{ width: "1px", height: 20, bgcolor: dark ? alpha("#fff", 0.16) : "#E2E6F0", mx: 0.5, flexShrink: 0 }} />
                <NavTabsScroller fade={barBg} arrowColor={dark ? "rgba(255,255,255,0.85)" : INK} gap={0.25} testId="role-nav-scroller">
                  {SALES_TABS.map((l, i) => tab(l, i === 1))}
                </NavTabsScroller>
              </>
            )}
          </Stack>
          <SearchField dark={dark} collapsible={search} />
          <Box sx={{ width: 120, height: 36, borderRadius: 999, bgcolor: dark ? alpha("#fff", 0.08) : "#F2F4FA", flexShrink: 0 }} />
        </Stack>

        <Typography variant="caption" sx={{ display: "block", px: 2, pt: 2, color: "text.secondary" }}>
          Dark bar
        </Typography>
        <Stack direction="row" alignItems="center" gap={0.5} sx={{ height: 52, px: 2, bgcolor: "#041627", color: "#fff" }} data-testid="bar-dark">
          <Typography sx={{ fontWeight: 800, letterSpacing: "0.06em", fontSize: "0.95rem", mr: 2, flexShrink: 0 }}>AIMS</Typography>
          {before ? <OldScroll mask={false}>{MODULES.map(darkItem)}</OldScroll> : <NavTabsScroller fade="#041627" arrowColor="#FFFFFF" testId="top-nav-scroller">{MODULES.map(darkItem)}</NavTabsScroller>}
          <Box sx={{ width: 220, height: 32, borderRadius: 1, bgcolor: "rgba(255,255,255,0.08)", flexShrink: 0, ml: 1 }} />
        </Stack>
      </Box>
    </ThemeProvider>
  );
}
