"use client";

// Fixture-rendered "Money spent" card of a vehicle (enableWctVehicles). No API, no sign-in. Served only with PREVIEW_FIXTURES=1.

import React, { useMemo } from "react";
import { Box, CssBaseline, Divider, Paper, Stack, Typography } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import lightTheme from "@/themes/lightTheme";
import darkTheme from "@/themes/darkTheme";
import MoneyColumn from "@/app/portal/assets/vehicles/_components/MoneyColumn";
import { LOG_TYPES, type MoneyPeriod } from "@/helpers/wctVehicles";

const period = (amounts: Partial<Record<(typeof LOG_TYPES)[number], number>>): MoneyPeriod => {
  const byType = Object.fromEntries(LOG_TYPES.map((t) => [t, amounts[t] ?? 0])) as MoneyPeriod["byType"];
  return { total: Object.values(byType).reduce((s, n) => s + n, 0), byType };
};

export default function PreviewClient({ mode }: { mode: "light" | "dark" }) {
  const theme = useMemo(() => (mode === "dark" ? darkTheme : lightTheme), [mode]);
  const [first, second] = LOG_TYPES;
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ p: 3, maxWidth: 1000, mx: "auto", bgcolor: "background.default", minHeight: "100vh" }}>
        <Paper variant="outlined" sx={{ p: 2.5 }}>
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
            Money spent
          </Typography>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={3} divider={<Divider orientation="vertical" flexItem />}>
            <MoneyColumn title="This month" p={period({})} />
            <MoneyColumn title="This year" p={period({ [first]: 420 })} />
            <MoneyColumn title="All time" p={period({ [first]: 1260.5, [second]: 380 })} />
          </Stack>
        </Paper>
      </Box>
    </ThemeProvider>
  );
}
