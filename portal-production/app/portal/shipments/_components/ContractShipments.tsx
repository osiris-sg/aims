"use client";

// Shipments under one contract, with "New shipment" preset to this contract.

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Box, Button, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tooltip, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import type { Contract } from "../_lib/api";
import { blLabel, fmtDay, lineLabel } from "../_lib/format";
import { CurrentStepCell, EmptyState, ProgressCell, RecordStatusChip } from "./bits";
import ShipmentFormDialog from "./ShipmentFormDialog";

export default function ContractShipments({ contract: c }: { contract: Contract }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const canAdd = c.status !== "CANCELLED";
  const open_ = (id: string) => router.push(`/portal/shipments/${id}`);

  const newButton = (
    <Tooltip title={canAdd ? "" : "Reopen the contract to add shipments"}>
      <span>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)} disabled={!canAdd}>
          New shipment
        </Button>
      </span>
    </Tooltip>
  );

  return (
    <Box>
      <Stack direction="row" alignItems="center" sx={{ mb: 1.5 }}>
        <Typography variant="body2" color="text.secondary">
          {c.shipments.length} shipment{c.shipments.length === 1 ? "" : "s"}
        </Typography>
        <Box sx={{ flex: 1 }} />
        {newButton}
      </Stack>
      {!c.shipments.length ? (
        <EmptyState title="No shipments under this contract yet" action={canAdd ? newButton : undefined} />
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small" sx={{ minWidth: 820 }}>
            <TableHead>
              <TableRow>
                <TableCell>B/L no.</TableCell>
                <TableCell>Product line</TableCell>
                <TableCell>Vessel</TableCell>
                <TableCell>ETD</TableCell>
                <TableCell>ETA</TableCell>
                <TableCell>Progress</TableCell>
                <TableCell>Current step</TableCell>
                <TableCell>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {c.shipments.map((s) => (
                <TableRow key={s.id} hover sx={{ cursor: "pointer" }} onClick={() => open_(s.id)}>
                  <TableCell sx={{ fontWeight: 600 }}>{blLabel(s.blNumber)}</TableCell>
                  <TableCell>{(() => {
                    const l = c.lines.find((x) => x.id === s.contractLineId);
                    return l ? lineLabel(l) : "—";
                  })()}</TableCell>
                  <TableCell>{s.vessel || "—"}</TableCell>
                  <TableCell>{fmtDay(s.etd)}</TableCell>
                  <TableCell>{fmtDay(s.eta)}</TableCell>
                  <TableCell>
                    <ProgressCell progress={s.progress} width={90} />
                  </TableCell>
                  <TableCell>
                    <CurrentStepCell step={s.currentStep} progress={s.progress} maxWidth={220} />
                  </TableCell>
                  <TableCell>
                    <RecordStatusChip status={s.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      <ShipmentFormDialog
        open={open}
        onClose={() => setOpen(false)}
        contract={{ id: c.id, contractNo: c.contractNo, currency: c.currency, deliveryMonth: c.deliveryMonth, lines: c.lines, customer: c.customer }}
        onSaved={(s) => router.push(`/portal/shipments/${s.id}`)}
      />
    </Box>
  );
}
