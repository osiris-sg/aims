"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import { Box, CircularProgress } from "@mui/material";

interface GoToLatestDocumentProps {
  documentTypes: string[]; // e.g., ["SO", "SALES_ORDER"] - types to filter by
  documentLabel: string; // e.g., "Sales Order", "Delivery Order"
  createDocumentType: string; // e.g., "SO" - the type to create if none exist
}

export default function GoToLatestDocument({
  documentTypes,
  documentLabel,
  createDocumentType,
}: GoToLatestDocumentProps) {
  const router = useRouter();
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const [, setError] = useState<string | null>(null);
  const hasRedirected = useRef(false);

  useEffect(() => {
    if (hasRedirected.current) return;

    const fetchAndRedirect = async () => {
      if (!organization?.id) return;

      hasRedirected.current = true;

      try {
        const token = await getToken();

        // Fetch documents and redirect to latest
        const response = await request(
          { path: "/documents", method: "POST" },
          { organizationId: organization.id },
          token ?? undefined
        );

        if (!response.success || !response.data) {
          setError("Failed to fetch documents");
          return;
        }

        // Filter and get latest
        const filteredDocs = response.data
          .filter((doc: any) => documentTypes.includes(doc.documentType))
          .sort((a: any, b: any) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          );

        if (filteredDocs.length === 0) {
          // No documents found - auto-create one
          console.log(`No ${documentLabel} found, auto-creating...`);

          // Get template ID for this document type
          const templateResponse = await request(
            { path: `/documentTemplates/type/${createDocumentType}`, method: "GET" },
            {},
            token ?? undefined
          );

          if (!templateResponse.success || !templateResponse.data?.id) {
            setError(`No template found for ${documentLabel}`);
            return;
          }

          const templateId = templateResponse.data.id;

          // Create the document
          const createResponse = await request(
            { path: "/documents/basic", method: "POST" },
            {
              type: createDocumentType,
              config: {},
              documentTemplateId: templateId,
              organizationId: organization.id,
            },
            token ?? undefined
          );

          if (createResponse?.success && createResponse?.data?.id) {
            router.replace(`/portal/documents/${createDocumentType}/${templateId}/${createResponse.data.id}`);
          } else {
            setError(`Failed to create ${documentLabel}`);
          }
          return;
        }

        const { documentType, templateId, id } = filteredDocs[0];
        router.replace(`/portal/documents/${documentType}/${templateId}/${id}`);
      } catch (err: any) {
        console.error("Error fetching documents:", err);
        setError(err.message || "An error occurred");
      }
    };

    fetchAndRedirect();
  }, [organization?.id, documentTypes, documentLabel, createDocumentType, getToken, router]);

  // Always show loading spinner - auto-create handles no documents case
  return (
    <Box
      sx={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        height: "50vh",
      }}
    >
      <CircularProgress size={32} />
    </Box>
  );
}
