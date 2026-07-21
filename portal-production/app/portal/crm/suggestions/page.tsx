"use client";

// CRM › Suggestions — review queue for AI-drafted WhatsApp replies that were
// not auto-sent. Approve (optionally edited) to send, or dismiss.

import { Box, Stack, Typography } from "@mui/material";
import { RateReview } from "@mui/icons-material";
import SuggestionsTab from "../_components/SuggestionsTab";

export default function CrmSuggestionsPage() {
  return (
    <Box sx={{ p: 3, maxWidth: 1100, mx: "auto" }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 3 }}>
        <RateReview color="primary" fontSize="large" />
        <Box>
          <Typography variant="h5" fontWeight={700}>
            Suggestions
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Replies the AI drafted but held back for review — approve, edit, or dismiss.
          </Typography>
        </Box>
      </Stack>
      <SuggestionsTab />
    </Box>
  );
}
