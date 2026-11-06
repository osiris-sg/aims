"use client";

import React from "react";
import FileUploadDialog from "@/app/portal/shipments/_components/FileUploadDialog";

export default function LinkPreview({ link }: { link: { id: string; label: string; docType?: string } | null }) {
  if (!link) return null;
  return <FileUploadDialog open onClose={() => undefined} defaultTargets={[{ kind: "shipment", id: link.id, label: link.label }]} docType={link.docType ?? "CI_PAYMENT_PROOF"} title={`Upload CI payment proof · ${link.label}`} />;
}
