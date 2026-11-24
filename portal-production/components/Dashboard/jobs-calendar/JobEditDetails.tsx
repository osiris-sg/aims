"use client";

import { fileSrc } from "@/helpers/fileUrl";
// One job form (WCT group, 2026-11-24): what the removed job page showed, inside the Edit job pop-up. Created by,
// "More details" (collapsed: Location on site, which prints on the job's DO under Deliver To), the Items and the
// Proof of job (field reports) read only, and the stamped-DO check (Verify / Reject) when the job has one.

import React, { useEffect, useState } from "react";
import { Accordion, AccordionDetails, AccordionSummary, Box, Chip, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { toast } from "react-toastify";
import VerificationPanel from "@/components/delivery/VerificationPanel";

const imgSrc = (k: string) => fileSrc(k);
const when = (iso: string | null | undefined) => (iso ? new Intl.DateTimeFormat("en-SG", { timeZone: "Asia/Singapore", day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso)) : "");
const KIND_LABEL: Record<string, string> = { DO_ACK: "Customer sign-off", DO_INSTALL: "Installation", DO_START: "Job started", SERVICE: "Service report" };

/** The job as GET /deliveries/:id returns it (only what is shown here). */
export interface JobEditRun {
  id: string;
  status: string;
  items: Array<{ id: string; quantity: number; description: string | null; asset: { name: string } | null; inventory: { sku: string } | null; document: { name: string | null; status: string } | null }>;
  reports: Array<{ id: string; kind: string; status: string; photos: string[]; signature: string | null; signedByName: string | null; signedAt: string | null; technicianName: string | null; createdAt: string }>;
  document?: { machineLocation?: string | null } | null;
  verification?: any;
}

export default function JobEditDetails({
  run,
  createdBy,
  saveLocation,
  onChanged,
}: {
  run: JobEditRun;
  createdBy: string | null;
  /** Location on site, saved on the job's DO. */
  saveLocation: (value: string) => Promise<{ ok: boolean; message?: string }>;
  onChanged: () => void;
}) {
  const hasDo = run.items.some((i) => !!i.document);
  const [location, setLocation] = useState(run.document?.machineLocation ?? "");
  useEffect(() => setLocation(run.document?.machineLocation ?? ""), [run.id, run.document?.machineLocation]);
  const proof = run.reports.filter((r) => r.kind !== "SERVICE");
  const blurLocation = async () => {
    if ((run.document?.machineLocation ?? "") === location.trim()) return;
    const r = await saveLocation(location.trim());
    if (!r.ok) toast.error(r.message || "Couldn't save the location");
  };

  return (
    <Stack spacing={1.5} data-tour="job-edit-details">
      {createdBy && (
        <TextField label="Created by" size="small" fullWidth value={createdBy} InputProps={{ readOnly: true }} disabled />
      )}
      {hasDo && (
        <Accordion disableGutters variant="outlined" sx={{ "&:before": { display: "none" } }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              More details
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <TextField label="Location on site" size="small" fullWidth value={location} onChange={(e) => setLocation(e.target.value)} onBlur={() => void blurLocation()} inputProps={{ maxLength: 200 }} />
          </AccordionDetails>
        </Accordion>
      )}
      {run.items.length > 0 && (
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>{`Items (${run.items.length})`}</Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Description</TableCell>
                <TableCell align="right">Qty</TableCell>
                <TableCell>DO</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {run.items.map((i) => (
                <TableRow key={i.id}>
                  <TableCell sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {i.asset?.name || i.description || "Item"}
                    {i.inventory?.sku ? ` (S/No ${i.inventory.sku})` : ""}
                  </TableCell>
                  <TableCell align="right">{i.quantity}</TableCell>
                  <TableCell>{i.document?.name ?? ""}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}
      <Box>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
          Proof of job
        </Typography>
        {proof.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No field reports recorded yet.
          </Typography>
        ) : (
          <Stack spacing={1}>
            {proof.map((r) => (
              <Box key={r.id} sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1 }}>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {KIND_LABEL[r.kind] ?? r.kind}
                  </Typography>
                  <Chip size="small" variant="outlined" label={r.signature ? "Signed" : "Unsigned"} color={r.signature ? "success" : "default"} />
                  <Typography variant="caption" color="text.secondary">
                    {[when(r.signedAt ?? r.createdAt), r.signedByName ?? r.technicianName].filter(Boolean).join(" · ")}
                  </Typography>
                </Stack>
                {(r.signature || r.photos.length > 0) && (
                  <Stack direction="row" spacing={1} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
                    {r.signature && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={imgSrc(r.signature)} alt="Customer signature" style={{ maxHeight: 56, maxWidth: 200, objectFit: "contain", border: "1px solid rgba(0,0,0,0.12)", background: "#fff" }} />
                    )}
                    {r.photos.map((p) => (
                      <a key={p} href={imgSrc(p)} target="_blank" rel="noopener noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={imgSrc(p)} alt="Job photo" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 4 }} />
                      </a>
                    ))}
                  </Stack>
                )}
              </Box>
            ))}
          </Stack>
        )}
      </Box>
      {run.verification && <VerificationPanel verification={run.verification} canDecide onChanged={onChanged} />}
    </Stack>
  );
}
