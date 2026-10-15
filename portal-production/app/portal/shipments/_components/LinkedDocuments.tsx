"use client";

// In-app documents (invoices) linked to a contract/shipment: shown in the
// Files tab's "Documents" section. Row click opens the invoice editor (Back
// returns here); the kebab unlinks. Only a CONFIRMED invoice counts for a
// step; a draft shows "Draft — confirm to count", and a deleted / voided one
// stays listed but flagged.

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Box, Chip, IconButton, Menu, MenuItem, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from "@mui/material";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import { toast } from "../_lib/toast";
import type { RecordDocLink } from "../_lib/api";
import { useDocTypeLabels, useTradeMutation } from "../_lib/hooks";
import { DOC_STATUS_LABEL, documentHref, fmtDate, fmtMoney } from "../_lib/format";
import { ConfirmDialog } from "./bits";

/** Status chip for a linked document: its own status, or Deleted / Voided. */
export const DocLinkChip = ({ link, onClick }: { link: RecordDocLink; onClick?: () => void }) => {
  const state = link.state ?? (link.deleted ? "deleted" : link.voided ? "voided" : "confirmed");
  const label =
    state === "deleted" ? "Deleted" : state === "voided" ? "Voided" : state === "draft" ? "Draft — confirm to count" : DOC_STATUS_LABEL(link.document?.status ?? "");
  const title =
    state === "draft"
      ? "Not counted yet: confirm the invoice to tick this requirement"
      : link.satisfies
        ? "Open the invoice"
        : "No longer counts: the invoice was deleted or voided";
  return (
    <Chip
      size="small"
      variant="outlined"
      color={link.satisfies ? "info" : state === "draft" ? "warning" : "error"}
      label={`${link.document?.number ?? "Invoice"} · ${label}`}
      onClick={onClick}
      clickable={!!onClick}
      title={title}
    />
  );
};

export default function LinkedDocuments({ links, returnTo, canEdit }: { links: RecordDocLink[]; returnTo: string; canEdit: boolean }) {
  const router = useRouter();
  const label = useDocTypeLabels();
  const [menu, setMenu] = useState<{ pos: { left: number; top: number }; link: RecordDocLink } | null>(null);
  const [toUnlink, setToUnlink] = useState<RecordDocLink | null>(null);
  const unlink = useTradeMutation((api, id: string) => api.unlinkDocument(id));

  const open = (l: RecordDocLink) => {
    if (l.document) router.push(documentHref(l.document, returnTo));
  };

  return (
    <Box sx={{ mb: 3 }}>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        Documents
      </Typography>
      {!links.length ? (
        <Typography variant="body2" color="text.secondary">
          No invoices linked yet.
        </Typography>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Document type</TableCell>
                <TableCell>Invoice</TableCell>
                <TableCell>Customer</TableCell>
                <TableCell align="right">Total</TableCell>
                <TableCell>Date</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {links.map((l) => (
                <TableRow key={l.id} hover sx={{ cursor: l.document ? "pointer" : "default" }} onClick={() => open(l)}>
                  <TableCell>{label(l.docType)}</TableCell>
                  <TableCell>
                    <DocLinkChip link={l} />
                  </TableCell>
                  <TableCell>{l.document?.customerName ?? "—"}</TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>
                    {fmtMoney(l.document?.total, l.document?.currency)}
                  </TableCell>
                  <TableCell>{fmtDate(l.document?.date)}</TableCell>
                  <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                    <IconButton size="small" aria-label="Document actions" onClick={(e) => setMenu({ pos: { left: e.clientX, top: e.clientY }, link: l })}>
                      <MoreVertIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Menu anchorReference="anchorPosition" anchorPosition={menu?.pos} open={!!menu} onClose={() => setMenu(null)}>
        <MenuItem
          disabled={!menu?.link.document}
          onClick={() => {
            const l = menu!.link;
            setMenu(null);
            open(l);
          }}
        >
          Open invoice
        </MenuItem>
        <MenuItem
          disabled={!canEdit}
          sx={{ color: "error.main" }}
          onClick={() => {
            const l = menu!.link;
            setMenu(null);
            setToUnlink(l);
          }}
        >
          Unlink
        </MenuItem>
      </Menu>

      <ConfirmDialog
        open={!!toUnlink}
        title={`Unlink ${toUnlink?.document?.number ?? "this invoice"}?`}
        confirmLabel="Unlink"
        destructive
        onClose={() => setToUnlink(null)}
        onConfirm={async () => {
          await unlink.mutateAsync(toUnlink!.id);
          toast.success("Invoice unlinked");
        }}
      />
    </Box>
  );
}
