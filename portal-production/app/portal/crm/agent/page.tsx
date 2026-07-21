"use client";

// CRM › AI Agent — per-org WhatsApp auto-responder settings, training
// examples, and the dry-run tester.

import { Box, Stack, Typography } from "@mui/material";
import { Psychology } from "@mui/icons-material";
import AgentTab from "../_components/AgentTab";

export default function CrmAgentPage() {
  return (
    <Box sx={{ p: 3, maxWidth: 1100, mx: "auto" }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 3 }}>
        <Psychology color="primary" fontSize="large" />
        <Box>
          <Typography variant="h5" fontWeight={700}>
            AI Agent
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Train the WhatsApp auto-responder with sample conversations and control what it may answer on its own.
          </Typography>
        </Box>
      </Stack>
      <AgentTab />
    </Box>
  );
}
