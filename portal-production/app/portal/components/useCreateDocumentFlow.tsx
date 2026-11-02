"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { useOrganization } from "@hooks/useOrganization";
import { useTemplatePicker } from "./useTemplatePicker";
import { useNumberFormatPicker } from "./useNumberFormatPicker";
import { newDocumentUrl } from "@/helpers/newDocument";

/**
 * THE document-creation flow, shared by every "Create <type>" button (sales
 * lists via DocumentListView, the AR tab's Invoice List, …) so the behaviour
 * is identical everywhere:
 *   1. number format — 0 → legacy numbering, 1 → auto, >1 → picker popup
 *   2. template      — 1 active → straight through, >1 → picker popup
 *   3. open the editor on a NEW, unsaved document ("New <type> (number on
 *      save)", 2026-11-02) with ?from=<here> so its Back returns to the
 *      ORIGINATING page (e.g. the AR tab). Nothing is created, and no number
 *      is used, until the first save; leaving without saving creates nothing.
 *
 * Usage:
 *   const { create, creating, dialogs } = useCreateDocumentFlow("INVOICE", "Invoice");
 *   // render {dialogs} once in the tree; wire `create` to the button.
 */
export function useCreateDocumentFlow(createDocumentType?: string, documentLabel = "document") {
  const router = useRouter();
  const { organization } = useOrganization();
  const { resolveTemplate, dialog: templatePickerDialog } = useTemplatePicker();
  const { resolveNumberFormat, dialog: numberFormatPickerDialog } = useNumberFormatPicker();
  const [creating, setCreating] = useState(false);

  const create = async () => {
    if (!organization?.id || !createDocumentType || creating) return;
    setCreating(true);
    try {
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
      const from = typeof window !== "undefined" ? window.location.pathname + window.location.search : "";
      router.push(newDocumentUrl({ type: createDocumentType, templateId, numberFormatId: numberFormatId ?? null }, { from }));
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
