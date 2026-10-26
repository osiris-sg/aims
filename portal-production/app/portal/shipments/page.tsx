"use client";

// Orders (round AM): one page, two views — "List | Monthly" at the top (?view=monthly, remembered per user).
//   List     the Orders tracker (OrdersListView: Pending / Completed, progress bars, + New order …)
//   Monthly  ADH's monthly spreadsheet (MonthlyView — formerly Sales › Monthly list, whose URL redirects here)

import React from "react";
import { Box, Stack } from "@mui/material";
import OrdersListView from "./_components/OrdersListView";
import MonthlyView from "./_components/MonthlyView";
import OrdersViewToggle, { useOrdersView } from "./_components/OrdersViewToggle";

export default function OrdersPage() {
  const [view, setView] = useOrdersView();
  const toggle = <OrdersViewToggle view={view} onChange={setView} />;
  return (
    <Box sx={{ p: { xs: 1.5, md: 3 }, height: "100%", width: "100%", maxWidth: "100vw", minWidth: 0, boxSizing: "border-box", display: "flex", flexDirection: "column" }}>
      {view === "monthly" ? (
        <>
          <Stack direction="row" sx={{ mb: 1.5 }}>{toggle}</Stack>
          <MonthlyView />
        </>
      ) : (
        <OrdersListView toolbar={toggle} />
      )}
    </Box>
  );
}
