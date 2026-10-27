"use client";

import React from "react";
import { Box, Typography } from "@mui/material";
import type { InboxLang, InboxThread } from "@/app/portal/shipments/_lib/api";
import { ChooseShipmentDialog } from "@/app/portal/shipments/_components/inbox/ChooseShipmentDialog";

/** The Answer dialog, open on the fixture thread; the answer is only logged. */
export default function AnswerPreview({ thread, lang }: { thread: InboxThread | null; lang: InboxLang }) {
  if (!thread) return <Typography sx={{ p: 3 }}>No answer fixture.</Typography>;
  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <ChooseShipmentDialog open t={thread} lang={lang} onClose={() => undefined} onAnswer={(_t, a) => console.log("[preview answer]", JSON.stringify(a))} onCreateOrder={() => undefined} />
    </Box>
  );
}
