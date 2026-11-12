"use client";

// The technician's WCT service walk on a job. The form itself is shared with
// the portal's office reports (components/service-report/WctServiceReportForm).
import { useParams } from "next/navigation";
import WctServiceReportForm from "@/components/service-report/WctServiceReportForm";

export default function WctServiceReportPage() {
  const params = useParams();
  return <WctServiceReportForm deliveryId={String(params?.deliveryId ?? "")} />;
}
