"use client";

// Orders (round AM): one page, two views — "List | Monthly" (?view=monthly, remembered per user).
//   List     the Orders tracker (Pending / Completed / All, progress bars, + New order …)
//   Monthly  ADH's monthly spreadsheet (MonthlyView — formerly Sales › Monthly list, whose URL redirects here)
// Round AN: one shared header for both (OrdersListView owns it); only the content below the tabs changes.

import React from "react";
import { Box } from "@mui/material";
import OrdersListView from "./_components/OrdersListView";
import { useOrdersView } from "./_components/OrdersViewToggle";

export default function OrdersPage() {
  const [view, setView] = useOrdersView();
  return (
    <Box sx={{ p: { xs: 1.5, md: 3 }, height: "100%", width: "100%", maxWidth: "100vw", minWidth: 0, boxSizing: "border-box", display: "flex", flexDirection: "column" }}>
      <OrdersListView view={view} onViewChange={setView} />
    </Box>
  );
}
