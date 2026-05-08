"use client";

import { Box, Paper, Stack, Typography } from "@mui/material";
import ConstructionIcon from "@mui/icons-material/Construction";

export default function ComingSoon({
  title,
  description,
  bullets,
}: {
  title: string;
  description: string;
  bullets?: string[];
}) {
  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
      <Box>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          {title}
        </Typography>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          {description}
        </Typography>
      </Box>

      <Paper variant="outlined" sx={{ p: 6, textAlign: "center" }}>
        <Stack alignItems="center" gap={2}>
          <ConstructionIcon sx={{ fontSize: 56, color: "text.secondary" }} />
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            Coming soon
          </Typography>
          <Typography variant="body2" sx={{ color: "text.secondary", maxWidth: 520 }}>
            This module is part of the accounting roadmap and will be built out incrementally.
          </Typography>
          {bullets && bullets.length > 0 && (
            <Box sx={{ textAlign: "left", mt: 1 }}>
              <Typography variant="overline" sx={{ color: "text.secondary" }}>
                Planned scope
              </Typography>
              <Stack component="ul" sx={{ pl: 3, m: 0 }} gap={0.5}>
                {bullets.map((b) => (
                  <Typography component="li" key={b} variant="body2">
                    {b}
                  </Typography>
                ))}
              </Stack>
            </Box>
          )}
        </Stack>
      </Paper>
    </Box>
  );
}
