"use client";

// Manual order flow (2026-11-13): the office fills a WCT service report in the
// portal, the same form the field app walks (components/service-report).
import { useParams } from "next/navigation";
import { Box } from "@mui/material";
import MainCard from "@/components/MainCard";
import WctServiceReportForm from "@/components/service-report/WctServiceReportForm";

export default function OfficeServiceReportFormPage() {
  const params = useParams();
  return (
    <MainCard>
      <Box sx={{ maxWidth: 720, mx: "auto" }}>
        <WctServiceReportForm reportId={String(params?.id ?? "")} office />
      </Box>
    </MainCard>
  );
}
