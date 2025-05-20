import MainCard from "@/components/MainCard";
import DocumentTemplates from "@/containers/DocumentTemplates";
import React from "react";

export default function ViewDocumentPage() {
  return (
    <MainCard>
      <DocumentTemplates viewMode={true} />
    </MainCard>
  );
}
