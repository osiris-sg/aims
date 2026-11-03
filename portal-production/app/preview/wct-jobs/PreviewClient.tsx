"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

// Fixture-rendered WCT Orders / Jobs pages (enableWctOrders). No API, no sign-in. Served only with PREVIEW_FIXTURES=1.

import React, { useMemo } from "react";
import { Box, CssBaseline } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import lightTheme from "@/themes/lightTheme";
import darkTheme from "@/themes/darkTheme";
import WctOrdersList from "@/app/portal/orders/WctOrdersList";
import WctJobsList, { type JobRow } from "@/app/portal/deliveries/_components/WctJobsList";

const at = (day: number, hh: number) => new Date(Date.parse(`2026-11-${String(day).padStart(2, "0")}T${String(hh).padStart(2, "0")}:00:00+08:00`)).toISOString();
const cust = (name: string) => ({ id: name, name, customerCode: null });

const ORDERS: any[] = [
  { id: "o1", orderNumber: "ORD202611-0003", status: "AWAITING_VERIFICATION", customer: cust("Ajiya Okonomiyaki Restaurant"), sourceQuotation: { id: "q1", name: "QO202611-0018", status: "confirmed" }, jobCounts: { total: 2, drafts: 0, completed: 1, cancelled: 0, awaitingVerification: 1 }, nextJobAt: at(5, 11), createdAt: at(1, 9) },
  { id: "o2", orderNumber: "ORD202611-0002", status: "SCHEDULED", customer: cust("Marina Bay Sands"), sourceQuotation: { id: "q2", name: "QO202611-0016", status: "confirmed" }, jobCounts: { total: 1, drafts: 0, completed: 0, cancelled: 0 }, nextJobAt: at(6, 14), createdAt: at(1, 8) },
  { id: "o3", orderNumber: "ORD202611-0001", status: "OPEN", customer: cust("Tampines Hub"), sourceQuotation: { id: "q3", name: "QO202611-0012", status: "signed" }, jobCounts: { total: 1, drafts: 1, completed: 0, cancelled: 0 }, nextJobAt: null, createdAt: at(1, 7) },
  { id: "o4", orderNumber: "ORD202610-0009", status: "INVOICED", customer: cust("Jewel Changi"), sourceQuotation: { id: "q4", name: "QO202610-0101", status: "confirmed" }, jobCounts: { total: 3, drafts: 0, completed: 3, cancelled: 0 }, nextJobAt: null, createdAt: at(1, 6) },
];

const job = (n: number, over: Partial<JobRow>): JobRow => ({
  id: `j${n}`, deliveryNumber: n, state: "scheduled", verificationState: null, verifiedByName: null, verifiedAt: null, scheduledFor: at(5, 10), order: { id: "o1", orderNumber: "ORD202611-0003" },
  customer: { id: "c", name: "Ajiya Okonomiyaki Restaurant" }, site: "E!Avenue #02-346, Singapore", worker: "Muhammad Ali", dos: [{ id: `d${n}`, name: `DO202611-00${n}` }], badges: [], ...over,
});
const PERMIT = { fieldId: "f1", label: "Permit required", icon: "permit", colour: "#2e7d32", text: "Yes" };
const JOBS: JobRow[] = [
  job(31, { state: "to_verify", verificationState: "pending", badges: [PERMIT], scheduledFor: at(3, 10) }),
  job(30, { state: "completed", verificationState: "verified", verifiedByName: "Hui Kong", order: { id: "o4", orderNumber: "ORD202610-0009" }, customer: { id: "c4", name: "Jewel Changi" }, site: "78 Airport Blvd", worker: "Kumar Raj", scheduledFor: at(2, 13) }),
  job(29, { state: "scheduled", order: { id: "o2", orderNumber: "ORD202611-0002" }, customer: { id: "c2", name: "Marina Bay Sands" }, site: "10 Bayfront Ave", worker: "Tan Wei Ming", scheduledFor: at(6, 14), badges: [PERMIT] }),
  job(28, { state: "draft", order: { id: "o3", orderNumber: "ORD202611-0001" }, customer: { id: "c3", name: "Tampines Hub" }, site: "1 Tampines Walk", worker: null, scheduledFor: null, dos: [] }),
  job(27, { state: "rejected", verificationState: "rejected", scheduledFor: at(2, 9), worker: "Lim Ah Kow" }),
];
const COUNTS = { all: 5, draft: 1, scheduled: 1, to_verify: 1, rejected: 1, completed: 1 };

export default function PreviewClient({ mode, page }: { mode: "light" | "dark"; page: "orders" | "jobs" }) {
  // The app's own themes (the table reads custom palette tokens).
  const theme = useMemo(() => (mode === "dark" ? darkTheme : lightTheme), [mode]);
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ p: 3, maxWidth: 1280, mx: "auto", bgcolor: "background.default", minHeight: "100vh" }}>
        {page === "orders" ? <WctOrdersList fixture={ORDERS} /> : <WctJobsList fixture={{ docs: JOBS, counts: COUNTS, workers: ["Kumar Raj", "Lim Ah Kow", "Muhammad Ali", "Tan Wei Ming"] }} />}
      </Box>
    </ThemeProvider>
  );
}
