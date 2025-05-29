import MainCard from "@/components/MainCard";
import DocumentTemplates from "@/containers/DocumentTemplates";
import React from "react";

export default function page() {
  return (
    <MainCard>
      <DocumentTemplates viewMode={false} />
    </MainCard>
  );
}
