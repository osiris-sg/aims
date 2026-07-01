"use client";

import Link from "next/link";
import { Box, Button, Stack } from "@mui/material";
import GeneralLedgerPage from "../general-ledger/page";

// "General Ledger" section — lands directly on the GL overview (all accounts in
// one scroll). Trial Balance / Audit Trail are one click away.
export default function LedgerSectionPage() {
  return (
    <Box>
      <Stack direction="row" gap={1} sx={{ px: 3, pt: 2 }}>
        <Button size="small" variant="contained" disableElevation>General Ledger</Button>
        <Button size="small" variant="text" component={Link} href="/portal/accounting/reports?tab=tb">
          Trial Balance
        </Button>
        <Button size="small" variant="text" component={Link} href="/portal/accounting/reports?tab=audit">
          Audit Trail
        </Button>
      </Stack>
      <GeneralLedgerPage />
    </Box>
  );
}
