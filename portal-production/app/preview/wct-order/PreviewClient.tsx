"use client";

// Fixture-rendered WCT order page (enableWctOrders): an AIMS order or an imported one, on the same layout (round 24).
// No API, no sign-in. Served only with PREVIEW_FIXTURES=1.

import React, { useMemo } from "react";
import { Box, CssBaseline } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import lightTheme from "@/themes/lightTheme";
import darkTheme from "@/themes/darkTheme";
import WctOrderDetail from "@/app/portal/orders/[id]/WctOrderDetail";
import { importedOrder, nativeOrder } from "./fixtures";

export default function PreviewClient({ mode, manual, kind }: { mode: "light" | "dark"; manual: boolean; kind: "native" | "imported" }) {
  const theme = useMemo(() => (mode === "dark" ? darkTheme : lightTheme), [mode]);
  const fixture = useMemo(() => (kind === "imported" ? importedOrder() : nativeOrder(manual)), [manual, kind]);
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ p: 3, maxWidth: 1280, mx: "auto", bgcolor: "background.default", minHeight: "100vh" }}>
        <WctOrderDetail id={fixture.id} fixture={fixture} />
      </Box>
    </ThemeProvider>
  );
}
