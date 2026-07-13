"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { toast } from "react-toastify";
import { request } from "@/helpers/request";
import { useOrganization } from "@hooks/useOrganization";
import { useTemplatePicker } from "./useTemplatePicker";
import { useNumberFormatPicker } from "./useNumberFormatPicker";

/**
 * THE document-creation flow, shared by every "Create <type>" button (sales
 * lists via DocumentListView, the AR tab's Invoice List, …) so the behaviour
 * is identical everywhere:
 *   1. number format — 0 → legacy numbering, 1 → auto, >1 → picker popup
 *   2. template      — 1 active → straight through, >1 → picker popup
 *   3. POST /documents/basic → navigate to the editor with ?from=<here> so
 *      the editor's Back returns to the ORIGINATING page (e.g. the AR tab).
 *
 * Usage:
 *   const { create, creating, dialogs } = useCreateDocumentFlow("INVOICE", "Invoice");
 *   // render {dialogs} once in the tree; wire `create` to the button.
 */
export function useCreateDocumentFlow(createDocumentType?: string, documentLabel = "document") {
  const router = useRouter();
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const { resolveTemplate, dialog: templatePickerDialog } = useTemplatePicker();
  const { resolveNumberFormat, dialog: numberFormatPickerDialog } = useNumberFormatPicker();
  const [creating, setCreating] = useState(false);

  const create = async () => {
    if (!organization?.id || !createDocumentType || creating) return;
    setCreating(true);
    try {
      const token = await getToken();
      // Step 1 — number format: 0 → legacy, 1 → auto, >1 → popup. null = cancelled.
      const nf = await resolveNumberFormat(createDocumentType);
      if (nf === null) {
        return;
      }
      const numberFormatId = nf || undefined;
      // Step 2 — template via the shared picker: 1 active → straight through,
      // >1 → popup, 0 → single-resolve fallback. null = no template OR the user
      // cancelled the popup → abort without creating anything.
      const templateId = await resolveTemplate(createDocumentType);
      if (!templateId) {
        return;
      }
      const created = await request(
        { path: "/documents/basic", method: "POST" },
        {
          type: createDocumentType,
          config: { ...(numberFormatId ? { numberFormatId } : {}) },
          documentTemplateId: templateId,
          organizationId: organization.id,
        },
        token ?? undefined
      );
      if (created?.success && created?.data?.id) {
        const from =
          typeof window !== "undefined"
            ? encodeURIComponent(window.location.pathname + window.location.search)
            : "";
        router.push(
          `/portal/documents/${createDocumentType}/${templateId}/${created.data.id}${from ? `?from=${from}` : ""}`
        );
      } else {
        toast.error(`Failed to create ${documentLabel}`);
      }
    } catch (err) {
      console.error("useCreateDocumentFlow create error:", err);
      toast.error(`Failed to create ${documentLabel}`);
    } finally {
      setCreating(false);
    }
  };

  const dialogs = (
    <>
      {numberFormatPickerDialog}
      {templatePickerDialog}
    </>
  );

  return { create, creating, dialogs };
}
