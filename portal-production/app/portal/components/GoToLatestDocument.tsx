"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import { Box, Button, CircularProgress, Typography } from "@mui/material";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import DocumentListView from "./DocumentListView";
import { useCreateDocumentFlow } from "./useCreateDocumentFlow";
import { latestDocumentAction } from "@/helpers/latestDocument";
import IdQuotationList from "@/app/portal/sales/quotations/id/_components/IdQuotationList";

const QUOTATION_CODES = ["QUOTATION", "QO", "QO1", "QO2", "QT"];

interface GoToLatestDocumentProps {
  documentTypes: string[]; // e.g., ["SO", "SALES_ORDER"] - types to filter by
  documentLabel: string; // e.g., "Sales Order", "Delivery Order"
  createDocumentType: string; // e.g., "SO" - the type to create if none exist
  /** One side of the books only — Sales credit notes are the ones WE issue to a
   *  customer; a supplier's credit note belongs in AP (guru 2026-11-12). */
  counterparty?: "CUSTOMER" | "SUPPLIER";
  pluralLabel?: string; // e.g., "Sales Orders" — used by list view stat cards
}

export default function GoToLatestDocument({
  documentTypes,
  documentLabel,
  createDocumentType,
  counterparty,
  pluralLabel,
}: GoToLatestDocumentProps) {
  const router = useRouter();
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const { isDocumentListViewEnabled, isIdQuotationEnabled, isLoading: featuresLoading } = useOrganizationFeatures();
  // Interior-design quotation mode: the Quotation menu renders its own list +
  // editor (sectioned quote), bypassing both the auto-redirect and the generic
  // document list. Other document types are unaffected.
  const idQuotationMode = isIdQuotationEnabled && documentTypes.some((t) => QUOTATION_CODES.includes(String(t).toUpperCase()));
  // An empty list never creates anything by itself (2026-11-02: opening an
  // empty Quotations page used to auto-create a blank quotation, burning a
  // document number each time). It shows an empty state; the button runs the
  // same create flow as every other "Create <type>" button.
  const { create, creating, dialogs: createFlowDialogs } = useCreateDocumentFlow(createDocumentType, documentLabel);
  const [empty, setEmpty] = useState(false);
  const [, setError] = useState<string | null>(null);
  const hasRedirected = useRef(false);

  useEffect(() => {
    if (hasRedirected.current) return;
    // Wait until the feature flag value is known before deciding.
    if (featuresLoading) return;
    // When list view is enabled, skip auto-redirect.
    if (isDocumentListViewEnabled) return;
    if (idQuotationMode) return;

    const fetchAndRedirect = async () => {
      if (!organization?.id) return;

      hasRedirected.current = true;

      try {
        const token = await getToken();

        // Ask the server for the single newest document of these types. This
        // used to fetch EVERY document in the org and sort in the browser —
        // 12s for Chong Aik's 25.8k documents (guru 2026-10-23).
        const response = await request(
          { path: "/documents/paginated", method: "POST" },
          { documentTypes, limit: 1, sortBy: "createdAt", sortDir: "desc" },
          token ?? undefined
        );

        if (!response.success || !response.data) {
          setError("Failed to fetch documents");
          return;
        }

        const filteredDocs: any[] = response.data.docs || [];

        if (latestDocumentAction(filteredDocs) === "empty") {
          setEmpty(true);
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
  }, [organization?.id, documentTypes, documentLabel, createDocumentType, getToken, router, isDocumentListViewEnabled, idQuotationMode, featuresLoading]);

  // Wait for feature flag to load before deciding which UI to render —
  // otherwise we'd briefly redirect, then unmount and show the list view.
  if (featuresLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", height: "50vh" }}>
        <CircularProgress size={32} />
      </Box>
    );
  }

  if (idQuotationMode) {
    return <IdQuotationList />;
  }
  if (isDocumentListViewEnabled) {
    return (
      <DocumentListView
        documentTypes={documentTypes}
        documentLabel={documentLabel}
        pluralLabel={pluralLabel}
        createDocumentType={createDocumentType}
        counterparty={counterparty}
      />
    );
  }

  // No document of this type yet: an empty state, nothing created until the click.
  if (empty) {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 2, height: "50vh", textAlign: "center", px: 2 }}>
        <Typography variant="h6">No {pluralLabel ?? `${documentLabel}s`} yet</Typography>
        <Typography variant="body2" color="text.secondary">
          Create the first one when you are ready.
        </Typography>
        <Button variant="contained" onClick={() => void create()} disabled={creating} data-tour="page-create-button">
          {creating ? <CircularProgress size={18} /> : `Create ${documentLabel}`}
        </Button>
        {createFlowDialogs}
      </Box>
    );
  }

  // Legacy behavior: open the latest document of these types.
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
