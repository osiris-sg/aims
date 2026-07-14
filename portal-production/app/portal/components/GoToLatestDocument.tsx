"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import { Box, CircularProgress } from "@mui/material";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import DocumentListView from "./DocumentListView";
import { useTemplatePicker } from "./useTemplatePicker";

interface GoToLatestDocumentProps {
  documentTypes: string[]; // e.g., ["SO", "SALES_ORDER"] - types to filter by
  documentLabel: string; // e.g., "Sales Order", "Delivery Order"
  createDocumentType: string; // e.g., "SO" - the type to create if none exist
  pluralLabel?: string; // e.g., "Sales Orders" — used by list view stat cards
}

export default function GoToLatestDocument({
  documentTypes,
  documentLabel,
  createDocumentType,
  pluralLabel,
}: GoToLatestDocumentProps) {
  const router = useRouter();
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const { isDocumentListViewEnabled, isLoading: featuresLoading } = useOrganizationFeatures();
  const { resolveTemplate, dialog: templatePickerDialog } = useTemplatePicker();
  const [, setError] = useState<string | null>(null);
  const hasRedirected = useRef(false);

  useEffect(() => {
    if (hasRedirected.current) return;
    // Wait until the feature flag value is known before deciding.
    if (featuresLoading) return;
    // When list view is enabled, skip auto-redirect.
    if (isDocumentListViewEnabled) return;

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

          // Resolve via the shared picker (self-gating: popup only if >1 active).
          // null = no template OR the user cancelled → abort the auto-create.
          const templateId = await resolveTemplate(createDocumentType);
          if (!templateId) {
            setError(`No template found for ${documentLabel}`);
            return;
          }

          // Create the document. Re-fetch the token — the list fetch + template
          // picker above can outlive the 60s Clerk token and 401 the create.
          const freshToken = await getToken();
          const createResponse = await request(
            { path: "/documents/basic", method: "POST" },
            {
              type: createDocumentType,
              config: {},
              documentTemplateId: templateId,
              organizationId: organization.id,
            },
            freshToken ?? token ?? undefined
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
  }, [organization?.id, documentTypes, documentLabel, createDocumentType, getToken, router, isDocumentListViewEnabled, featuresLoading, resolveTemplate]);

  // Wait for feature flag to load before deciding which UI to render —
  // otherwise we'd briefly redirect, then unmount and show the list view.
  if (featuresLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", height: "50vh" }}>
        <CircularProgress size={32} />
      </Box>
    );
  }

  if (isDocumentListViewEnabled) {
    return (
      <DocumentListView
        documentTypes={documentTypes}
        documentLabel={documentLabel}
        pluralLabel={pluralLabel}
        createDocumentType={createDocumentType}
      />
    );
  }

  // Legacy behavior — auto-redirect to latest (or auto-create if none). The
  // template picker may surface here when the auto-create hits a type with >1
  // active template.
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
      {templatePickerDialog}
    </Box>
  );
}
