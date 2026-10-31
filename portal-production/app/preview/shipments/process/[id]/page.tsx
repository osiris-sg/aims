"use client";

// Round AY — /preview/shipments/process/<orderId>: the order page's Overall process and My tasks, rendered from the
// preview fixture (no sign-in, no API) for the round report's screenshots.

import React from "react";
import { useParams } from "next/navigation";
import { Box, Paper, Stack, Typography } from "@mui/material";
import OverallProcess from "@/app/portal/shipments/_components/OverallProcess";
import { TradeTasksList, useMyTasks } from "@/app/portal/shipments/_components/TradeTasks";

export default function PreviewProcess() {
  const { id } = useParams<{ id: string }>();
  const tasks = useMyTasks();
  return (
    <Box sx={{ p: { xs: 1.5, md: 3 } }}>
      <Stack spacing={3}>
        <OverallProcess orderId={id} />
        <Paper variant="outlined" sx={{ p: 2, maxWidth: 720 }} data-tour="preview-tasks">
          <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1 }}>My tasks today</Typography>
          <TradeTasksList alerts={tasks.data?.slice(0, 12)} loading={tasks.isLoading} onChanged={() => undefined} />
        </Paper>
      </Stack>
    </Box>
  );
}
