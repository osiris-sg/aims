"use client";

import React, { useCallback, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { Box } from "@mui/material";
import { request } from "@/helpers/request";
import CleanDocumentPreview from "@/containers/DocumentTemplates/components/CleanDocumentPreview";
import { transformBackendDataForForm } from "@/containers/DocumentTemplates/utils/documentDataTransformer";
import {
  getDotWidth,
  printRasterPages,
  rasterizeNode,
  splitIntoPages,
  type PrintProgress,
} from "../lib/a4Print";
import type { SavedPrinter } from "../lib/btPrinter";

/**
 * Print the REAL A4 delivery order over Bluetooth.
 *
 * The Print DO button lives on confirmation screens that never render the
 * document, so the document has to exist in the DOM before it can be
 * rasterised. This mounts it OFFSCREEN at the fixed A4 width and photographs
 * it — the same CleanDocumentPreview node, the same `do-view` fetch and the
 * same transform the field's read-only DO view uses, which is in turn the one
 * the portal's Print/PDF runs react-to-print over. One render, three outputs.
 *
 * Offscreen, NOT hidden: `display:none` and `visibility:hidden` both give
 * html2canvas a zero-size or unpainted node and it captures a blank page. The
 * node must be laid out and painted, just positioned outside the viewport.
 */

const A4_WIDTH_PX = 794; // 210mm @ 96dpi — CleanDocumentPreview's fixed Paper width

/**
 * Wait for the offscreen document to be ready to photograph.
 *
 * Two things land late and both are visible if missed: webfonts (text reflows
 * and the capture clips) and the logo / signature images off S3 (they capture
 * blank). A fixed sleep would be a guess; this waits on the real signals and
 * only then yields a frame for layout to settle.
 */
async function waitForPaint(node: HTMLElement): Promise<void> {
  try {
    await (document as any).fonts?.ready;
  } catch {
    // Font Loading API missing — the frame wait below still helps.
  }
  const images = Array.from(node.querySelectorAll("img"));
  await Promise.all(
    images.map(
      (img) =>
        img.complete
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              // Resolve on error too: one broken logo must not hang the print.
              img.addEventListener("load", () => resolve(), { once: true });
              img.addEventListener("error", () => resolve(), { once: true });
            }),
    ),
  );
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
}

export interface UseDoA4PrintResult {
  /** Mount this somewhere in the tree — it renders nothing visible. */
  surface: React.ReactNode;
  /** Fetch, render, rasterise and send. Rejects with a rider-readable message. */
  printDo: (doId: string, printer: SavedPrinter) => Promise<void>;
  progress: PrintProgress | null;
}

export function useDoA4Print(): UseDoA4PrintResult {
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const holderRef = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<{ data: any; variant: string; reports: any[] } | null>(null);
  const [progress, setProgress] = useState<PrintProgress | null>(null);

  const printDo = useCallback(
    async (doId: string, printer: SavedPrinter) => {
      setProgress({ page: 1, pageCount: 1, fraction: 0, label: "Loading the delivery order…" });
      try {
        const token = await getToken();
        if (!token) throw new Error("Not signed in");

        // Identical call to the field DO view — one field-gated aggregator
        // (field-scan:access), which the field-tech role can reach.
        const res = await request({ path: `/maintenance-reports/do-view/${doId}`, method: "GET" }, {}, token);
        if (res?.success === false || !res?.data) {
          throw new Error(res?.message ?? "Delivery order not found");
        }
        const { document: docRow, documentNumber, status, maintenanceReports: reports, templateVariant, fieldConfig } = res.data;
        const formData = transformBackendDataForForm(docRow?.config ?? {}, fieldConfig);
        formData.name = documentNumber;
        formData.documentNumber = documentNumber;
        formData.status = status;

        setDoc({ data: formData, variant: templateVariant || "DO", reports: Array.isArray(reports) ? reports : [] });

        // Let React commit the offscreen render before measuring it.
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
        const node = holderRef.current;
        if (!node) throw new Error("Could not prepare the document for printing");
        await waitForPaint(node);

        setProgress({ page: 1, pageCount: 1, fraction: 0, label: "Preparing the page…" });

        // CleanDocumentPreview renders ONE continuous A4-wide Paper and leaves
        // pagination to the browser's print engine, so there is no per-page node
        // to capture. Rasterise the whole document once, then cut it into
        // A4-height pages — the capture is pinned to a known 210mm width, so
        // page height follows from geometry.
        const pages = splitIntoPages(await rasterizeNode(node, getDotWidth()));

        await printRasterPages(pages, printer, setProgress);
      } finally {
        setProgress(null);
        setDoc(null);
      }
    },
    [getToken],
  );

  const surface = (
    <Box
      aria-hidden
      sx={{
        // Laid out and painted, but off-viewport — see the docblock.
        position: "fixed",
        left: -100000,
        top: 0,
        width: A4_WIDTH_PX,
        bgcolor: "#fff",
        pointerEvents: "none",
        zIndex: -1,
      }}
    >
      <div ref={holderRef} style={{ width: A4_WIDTH_PX, background: "#fff" }}>
        {doc && (
          <CleanDocumentPreview
            documentType={doc.variant}
            data={doc.data}
            organization={organization}
            maintenanceReports={doc.reports}
          />
        )}
      </div>
    </Box>
  );

  return { surface, printDo, progress };
}
