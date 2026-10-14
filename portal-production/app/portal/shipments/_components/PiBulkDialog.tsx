/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// "New contracts from PIs": drop several PI PDFs → each is stored and read by
// AI → one draft contract per PI → "Review & create" opens the normal contract
// form prefilled (same as Fill from PI). A PI whose contract number already
// exists is flagged and skipped. Closing the dialog removes the PDFs of PIs
// that were not created (they stay only when a contract was saved from them).

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import { useShipmentsApi, type Contract, type PiExtraction } from "../_lib/api";
import { fmtMoney, fmtMonth } from "../_lib/format";
import ContractFormDialog from "./ContractFormDialog";
import { PdfDropZone } from "./PdfDrop";

type Row = {
  key: string;
  fileName: string;
  state: "reading" | "ready" | "exists" | "failed" | "created";
  extraction?: PiExtraction;
  error?: string;
  created?: Contract;
  file?: File;
};

let seq = 0;

export default function PiBulkDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const api = useShipmentsApi();
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [review, setReview] = useState<Row | null>(null);
  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const read = async (row: Row) => {
    update(row.key, { state: "reading", error: undefined });
    try {
      const x = await api.extractPi(row.extraction ? { fileId: row.extraction.fileId } : { file: row.file! });
      if (x.status !== "DONE" || !x.result) update(row.key, { state: "failed", extraction: x, error: x.error || "Could not read this PI" });
      else update(row.key, { state: x.result.existingContractId ? "exists" : "ready", extraction: x });
    } catch (e: any) {
      update(row.key, { state: "failed", error: e?.message || "Could not read this PI" });
    }
  };

  const add = async (files: File[]) => {
    const fresh = files.map((f) => ({ key: `pi-${++seq}`, fileName: f.name, state: "reading" as const, file: f }));
    setRows((rs) => [...rs, ...fresh]);
    // Two at a time: each read takes ~10 s.
    const queue = [...fresh];
    await Promise.all(
      [0, 1].map(async () => {
        for (let r = queue.shift(); r; r = queue.shift()) await read(r);
      }),
    );
  };

  const busy = rows.some((r) => r.state === "reading");
  const close = () => {
    if (busy) return;
    // PIs not turned into a contract (skipped, failed, or never reviewed) are removed again.
    for (const r of rows) if (r.state !== "created" && r.extraction?.fileId) void api.discardSource(r.extraction.fileId).catch(() => undefined);
    setRows([]);
    onClose();
  };

  return (
    <>
      <Dialog open={open && !review} onClose={close} maxWidth="lg" fullWidth>
        <DialogTitle>New contracts from PIs</DialogTitle>
        <DialogContent dividers>
          <PdfDropZone
            multiple
            title="Drop PI PDFs here"
            busy={busy}
            busyText={`Reading ${rows.filter((r) => r.state === "reading").length} PI(s)…`}
            onFiles={(f) => void add(f)}
            dataTour="contracts-from-pis"
          />
          {rows.length > 0 && (
            <Table size="small" sx={{ mt: 2 }}>
              <TableHead>
                <TableRow>
                  <TableCell>File</TableCell>
                  <TableCell>Contract no.</TableCell>
                  <TableCell>PI no.</TableCell>
                  <TableCell>Lines</TableCell>
                  <TableCell>Shipment</TableCell>
                  <TableCell align="right">PI amount</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r) => {
                  const d = r.extraction?.result?.draft;
                  return (
                    <TableRow key={r.key}>
                      <TableCell sx={{ maxWidth: 220 }}>
                        <Typography variant="body2" noWrap title={r.fileName}>
                          {r.fileName}
                        </Typography>
                      </TableCell>
                      <TableCell>{d?.contractNo ?? "—"}</TableCell>
                      <TableCell>{d?.piNumber ?? "—"}</TableCell>
                      <TableCell>{d ? d.lines.map((l) => [l.grade, l.sizeSpec, l.quantityMt != null ? `${l.quantityMt} MT` : null].filter(Boolean).join(" ")).join(", ") || "—" : "—"}</TableCell>
                      <TableCell>{d?.shipmentMonth ? fmtMonth(d.shipmentMonth) : "—"}</TableCell>
                      <TableCell align="right">{d?.piAmount != null ? fmtMoney(d.piAmount, d.currency) : "—"}</TableCell>
                      <TableCell>
                        {r.state === "reading" && <CircularProgress size={16} />}
                        {r.state === "ready" && <Chip size="small" variant="outlined" color="info" label="Ready to review" />}
                        {r.state === "exists" && <Chip size="small" variant="outlined" color="warning" label="Contract already exists — skipped" />}
                        {r.state === "created" && <Chip size="small" variant="outlined" color="success" label="Created" />}
                        {r.state === "failed" && (
                          <Typography variant="caption" color="error">
                            {r.error}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                        {r.state === "ready" && (
                          <Button size="small" variant="contained" onClick={() => setReview(r)}>
                            Review & create
                          </Button>
                        )}
                        {r.state === "created" && r.created && (
                          <Button size="small" onClick={() => router.push(`/portal/shipments/contracts/${r.created!.id}`)}>
                            Open
                          </Button>
                        )}
                        {r.state === "exists" && r.extraction?.result?.existingContractId && (
                          <Button size="small" onClick={() => router.push(`/portal/shipments/contracts/${(r.extraction!.result as any).existingContractId}`)}>
                            Open existing
                          </Button>
                        )}
                        {r.state === "failed" && (r.file || r.extraction) && (
                          <Button size="small" onClick={() => void read(r)}>
                            Retry
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          <Box sx={{ mt: 1 }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={close} disabled={busy}>
            Close
          </Button>
        </DialogActions>
      </Dialog>
      <ContractFormDialog
        open={!!review}
        prefill={review?.extraction ?? null}
        onClose={() => setReview(null)}
        onSaved={(c) => {
          if (review) update(review.key, { state: "created", created: c });
        }}
      />
    </>
  );
}
