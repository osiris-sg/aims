"use client";

import React, { useCallback, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Box } from "@mui/material";
import { request } from "@/helpers/request";
import { GENERIC_CHECKLIST, TEMPLATE_LABELS, templateFor } from "@/lib/msr-templates";
import {
  FieldLabel,
  renderEssBody,
  renderEssConclusion,
  SignatureBlock,
} from "@/components/maintenance/EssReportView";
import {
  printHtmlViaSystem,
  savePdfViaSystem,
  serializeNodeToPrintHtml,
} from "../lib/systemPrint";

/**
 * Print / download a MAINTENANCE REPORT.
 *
 * It renders THE OFFICE PAGE'S LAYOUT — literally the same `renderEssBody` and
 * `renderEssConclusion` the dashboard uses, imported from the shared module —
 * not the old 58mm-era checklist card and not a print-only rewrite. The field
 * and the office are the same Next.js app, so sharing the React makes the two
 * identical by construction; a second implementation would be free to drift the
 * moment either changed.
 *
 * The template comes from the ROW's stamped `templateId`, never from the asset:
 * an ESS asset's older GENERIC report must keep rendering as the form it was
 * captured on.
 */

const A4_WIDTH_PX = 794; // 210mm @ 96dpi

/** Same page geometry as every other DO/report print path. */
const MSR_PRINT_PAGE_STYLE = `
  @page {
    size: A4;
    margin: 10mm;
    @top-left { content: ""; }
    @top-center { content: ""; }
    @top-right { content: ""; }
    @bottom-left { content: ""; }
    @bottom-center { content: ""; }
    @bottom-right { content: ""; }
  }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; margin: 0; padding: 0; }
    .msr-section, .msr-category, .msr-defects, .msr-poweron, .msr-signatures {
      break-inside: avoid; page-break-inside: avoid;
    }
  }
`;

const RESOURCE_URL =
  process.env.NEXT_PUBLIC_RESOURCE_URL ?? "https://aims-osiris.s3.ap-southeast-1.amazonaws.com/";

async function waitForPaint(node: HTMLElement): Promise<void> {
  try {
    await (document as any).fonts?.ready;
  } catch {
    /* Font Loading API missing — the frame wait below still helps. */
  }
  await Promise.all(
    Array.from(node.querySelectorAll("img")).map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            img.addEventListener("load", () => resolve(), { once: true });
            img.addEventListener("error", () => resolve(), { once: true });
          }),
    ),
  );
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
}

export interface UseMsrPrintResult {
  surface: React.ReactNode;
  printReport: (reportId: string) => Promise<void>;
  downloadReport: (reportId: string) => Promise<{ uri: string; fileName: string }>;
  busy: string | null;
}

export function useMsrPrint(): UseMsrPrintResult {
  const { getToken } = useAuth();
  const holderRef = useRef<HTMLDivElement>(null);
  const [report, setReport] = useState<any | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const prepare = useCallback(
    async (reportId: string): Promise<{ node: HTMLElement; title: string }> => {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await request({ path: `/maintenance-reports/${reportId}`, method: "GET" }, {}, token);
      const data = res?.data ?? res;
      if (!data?.id) throw new Error("Report not found");
      setReport(data);
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      const node = holderRef.current;
      if (!node) throw new Error("Could not prepare the report for printing");
      await waitForPaint(node);
      return { node, title: `Report-${data.reportNumber ?? data.id.slice(0, 8)}` };
    },
    [getToken],
  );

  const printReport = useCallback(
    async (reportId: string) => {
      setBusy("Loading the report…");
      try {
        const { node, title } = await prepare(reportId);
        setBusy("Preparing the document…");
        const html = await serializeNodeToPrintHtml(node, { title, pageStyle: MSR_PRINT_PAGE_STYLE });
        setBusy("Opening the print dialog…");
        await printHtmlViaSystem(html, title);
      } finally {
        setBusy(null);
        setReport(null);
      }
    },
    [prepare],
  );

  const downloadReport = useCallback(
    async (reportId: string) => {
      setBusy("Loading the report…");
      try {
        const { node, title } = await prepare(reportId);
        setBusy("Preparing the document…");
        const html = await serializeNodeToPrintHtml(node, { title, pageStyle: MSR_PRINT_PAGE_STYLE });
        setBusy("Saving the PDF…");
        return await savePdfViaSystem(html, title);
      } finally {
        setBusy(null);
        setReport(null);
      }
    },
    [prepare],
  );

  const sd = report?.serviceData ?? {};
  const templateId = templateFor(sd?.templateId);
  const isEss = templateId === "ESS_V1";
  const checkedSet = new Set<number>(sd?.checklist ?? []);
  const techSigUrl = sd?.techSignatureKey ? `${RESOURCE_URL}${sd.techSignatureKey}` : null;
  const clientSigUrl = sd?.clientSignatureKey ? `${RESOURCE_URL}${sd.clientSignatureKey}` : null;

  const surface = (
    <Box
      aria-hidden
      sx={{ position: "fixed", left: -100000, top: 0, width: A4_WIDTH_PX, bgcolor: "#fff", pointerEvents: "none", zIndex: -1 }}
    >
      <div ref={holderRef} style={{ width: A4_WIDTH_PX, background: "#fff", padding: 16 }}>
        {report && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <Box sx={{ border: 1, borderColor: "divider", p: 2 }} className="msr-section">
              <h2 style={{ margin: 0 }}>{TEMPLATE_LABELS[templateId]}</h2>
              <div style={{ fontSize: 12, color: "#555" }}>Report #{report.reportNumber ?? "—"}</div>
              <Box sx={{ display: "flex", gap: 4, mt: 1 }}>
                <Box sx={{ flex: 1 }}>
                  <FieldLabel label="Company Name" value={sd.customerName} />
                  <FieldLabel label="Job Location" value={sd.jobLocation} />
                  <FieldLabel label="Technician" value={report.technicianName} />
                </Box>
                <Box sx={{ flex: 1 }}>
                  <FieldLabel label="Model" value={sd.model ?? report.asset?.name} />
                  <FieldLabel label="Serial No" value={sd.serial ?? report.inventory?.sku} />
                  <FieldLabel label="Service Date" value={sd.serviceDate} />
                  <FieldLabel label="Next Service Date" value={sd.nextServiceDate} />
                </Box>
              </Box>
            </Box>

            {isEss ? (
              renderEssBody(report.serviceData?.ess ?? null, sd.nextServiceDate)
            ) : (
              <Box sx={{ border: 1, borderColor: "divider", p: 2 }} className="msr-section">
                <strong>Checklist</strong>
                <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", mt: 1 }}>
                  {GENERIC_CHECKLIST.map((item) => (
                    <div key={item.id} style={{ fontSize: 12 }}>
                      {checkedSet.has(item.id) ? "☑" : "☐"} {item.id}. {item.label}
                    </div>
                  ))}
                </Box>
              </Box>
            )}

            <Box sx={{ border: 1, borderColor: "divider", p: 2 }} className="msr-section">
              <strong>Remarks &amp; Times</strong>
              <div style={{ fontSize: 12, whiteSpace: "pre-wrap", marginTop: 6 }}>{sd.remarks || "—"}</div>
            </Box>

            {isEss && renderEssConclusion(report.serviceData?.ess ?? null)}

            <Box sx={{ border: 1, borderColor: "divider", p: 2 }} className="msr-section msr-signatures">
              <strong>Signatures</strong>
              <Box sx={{ display: "flex", gap: 2, mt: 1 }}>
                <Box sx={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: "#555" }}>{isEss ? "Inspector" : "Service By"}</div>
                  <SignatureBlock url={techSigUrl} name={report.technicianName ?? "—"} />
                </Box>
                {isEss && (
                  <Box sx={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: "#555" }}>Reviewer</div>
                    <SignatureBlock url={techSigUrl} name={report.technicianName ?? "—"} />
                  </Box>
                )}
                <Box sx={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: "#555" }}>Client</div>
                  <SignatureBlock url={clientSigUrl} name={sd.clientSignerName ?? report.signedByName ?? "—"} />
                </Box>
              </Box>
            </Box>
          </Box>
        )}
      </div>
    </Box>
  );

  return { surface, printReport, downloadReport, busy };
}
