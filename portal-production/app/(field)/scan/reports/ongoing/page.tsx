"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Box, Button, Stack, Typography } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { PendingSignList } from "../../../components/PendingSignList";

/**
 * ONGOING REPORTS — maintenance reports awaiting a signature.
 *
 * These are reports the technician submitted with Skip because the person who
 * signs was not on site. They are complete in every other respect: numbered,
 * with all findings stored. Server-side they sit at `status: draft` and carry
 * no signature, the same shape a scheduled delivery uses to mean "real, but not
 * finished yet".
 *
 * Grouped by customer on purpose. The whole reason Skip exists is that a
 * technician works several machines for one client and the signatory appears
 * once at the end — so the list they need is "everything this client still owes
 * me a signature for", not a flat chronological feed.
 *
 * The list itself (fetch, focus re-read, grouping, batch selection and the
 * batch bar) lives in components/PendingSignList, shared with the Maintenance
 * home's Pending tab.
 *
 * BATCH SIGNING. Tapping a row still opens that one report, unchanged. Ticking
 * rows instead builds a batch: the bar at the bottom carries them to
 * /scan/reports/sign-batch, where ONE signature pair is captured and applied to
 * all of them. Selection is locked to a SINGLE CUSTOMER — the moment one group
 * has a tick, every other group's checkboxes go disabled — because a client can
 * only certify their own machines, and a batch that silently spanned two
 * customers would put one client's signature on another's report. The grouping
 * this list has always had is what makes that restriction cost nothing: the
 * reports for one client are already sitting together.
 */

export default function OngoingReportsPage() {
  const router = useRouter();
  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => router.push("/scan")}>
          Back
        </Button>
      </Stack>

      <Box>
        <Typography variant="h6" fontWeight={700}>
          Pending Sign
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Reports waiting for a signature. Tap one to sign it, or tick several from the
          same customer to sign them with one signature.
        </Typography>
      </Box>

      <PendingSignList />
    </Box>
  );
}
