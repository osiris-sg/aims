"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

// Fixture-rendered WCT order page (enableWctOrders). No API, no sign-in. Served only with PREVIEW_FIXTURES=1.

import React, { useMemo } from "react";
import { Box, CssBaseline } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import lightTheme from "@/themes/lightTheme";
import darkTheme from "@/themes/darkTheme";
import WctOrderDetail, { type WctOrder } from "@/app/portal/orders/[id]/WctOrderDetail";

const order = (manual: boolean): WctOrder =>
  ({
    id: "o1",
    orderNumber: "ORD202611-0003",
    status: "INVOICED",
    createdAt: "2026-11-01T01:00:00.000Z",
    customer: { id: "c1", name: "Ajiya Okonomiyaki Restaurant", customerCode: "A001", address: "E!Avenue #02-346", email: "ops@example.com" },
    sourceQuotation: { id: "q1", name: "QO202611-0018", status: "confirmed", type: "QUOTATION", documentTemplateId: "t1" },
    jobs: [],
    prefill: { siteAddress: "E!Avenue #02-346", lines: [] },
    invoices: [{ id: "i1", name: "INV202611-0007", status: "pending_payment", href: "#", total: 1280, jobNumbers: [], emailed: true }],
    toInvoice: [],
    attachments: [],
    jobReports: [],
    manualFlow: manual,
    deliveryOrders: manual
      ? [{ id: "d1", name: "DO202611-0011", status: "completed", templateId: "t2", completed: true, awaitingSignature: false, invoiceId: "i1", hasProducts: false, jobs: [] }]
      : [],
    statusDates: {},
  }) as any;

export default function PreviewClient({ mode, manual }: { mode: "light" | "dark"; manual: boolean }) {
  const theme = useMemo(() => (mode === "dark" ? darkTheme : lightTheme), [mode]);
  const fixture = useMemo(() => order(manual), [manual]);
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ p: 3, maxWidth: 1280, mx: "auto", bgcolor: "background.default", minHeight: "100vh" }}>
        <WctOrderDetail id="o1" fixture={fixture} />
      </Box>
    </ThemeProvider>
  );
}
