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
import {
  DO_PRINT_PAGE_STYLE,
  printHtmlViaSystem,
  serializeNodeToPrintHtml,
} from "../lib/systemPrint";

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
  /** BLUETOOTH: fetch, render, rasterise and send over SPP. Currently unused by
   *  the Print DO button — kept wired for the thermal A4 unit. */
  printDo: (doId: string, printer: SavedPrinter) => Promise<void>;
  /** ANDROID PRINT DIALOG: what the Print DO button calls. */
  printDoViaSystem: (doId: string) => Promise<void>;
  progress: PrintProgress | null;
}

export function useDoA4Print(): UseDoA4PrintResult {
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const holderRef = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<{ data: any; variant: string; reports: any[] } | null>(null);
  const [progress, setProgress] = useState<PrintProgress | null>(null);

  /**
   * Fetch the DO, render it offscreen and wait until it is safe to capture.
   * Shared by BOTH print roads so neither can drift from the other, and so the
   * document on paper is the same one either way.
   */
  const prepare = useCallback(
    async (doId: string): Promise<{ node: HTMLElement; documentNumber: string }> => {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");

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
      return { node, documentNumber: documentNumber ?? "Delivery Order" };
    },
    [getToken],
  );

  /**
   * Print through ANDROID'S OWN print system — the dialog Chrome shows.
   *
   * This is the road to the WiFi inkjet: the rider taps Print DO, Android's
   * dialog opens with the printer list, and they pick the 小篆 X1000. No
   * Bluetooth pairing, no dot width, no raster.
   *
   * The document handed over is the same offscreen CleanDocumentPreview render
   * the Bluetooth path uses, serialised with the canonical 6mm/186×277mm print
   * CSS — so the sheet matches the portal's Print/PDF and the guest view.
   */
  const printDoViaSystem = useCallback(
    async (doId: string) => {
      setProgress({ page: 1, pageCount: 1, fraction: 0, label: "Loading the delivery order…" });
      try {
        const { node, documentNumber } = await prepare(doId);
        setProgress({ page: 1, pageCount: 1, fraction: 0.5, label: "Preparing the document…" });
        const html = await serializeNodeToPrintHtml(node, {
          title: documentNumber,
          pageStyle: DO_PRINT_PAGE_STYLE,
        });
        setProgress({ page: 1, pageCount: 1, fraction: 0.9, label: "Opening the print dialog…" });
        await printHtmlViaSystem(html, documentNumber);
      } finally {
        setProgress(null);
        setDoc(null);
      }
    },
    [prepare],
  );

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

  return { surface, printDo, printDoViaSystem, progress };
}
