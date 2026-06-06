"use client";

/**
 * Route Order PO footer block: editable "Less Points" line + the org's
 * Total Points balance with inline edit + projected remainder.
 *
 *  Less Points: [-amount]      ← editable; defaults to Σ items.points × qty
 *  Balance: 50,000  (Edit)     ← inline-editable org-wide ledger
 *  After confirm: 45,020       ← balance − redeemed
 *
 * Confirming the PO debits the balance by `pointsRedeemed`. That happens
 * server-side in documents.service.ts on the status='confirmed' flip; we
 * just project the math here so the user can see the consequence.
 */

import React, { useEffect, useState } from "react";
import { Box, Button, IconButton, Stack, TextField, Tooltip, Typography } from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import RestoreIcon from "@mui/icons-material/Restore";
import { useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";
import { toast } from "react-toastify";

interface Props {
  currency: string;
  autoComputed: number;             // Σ items.points × qty (the default redemption)
  redeemed: number;                  // the value currently in use for the totals
  onChangeRedeemed: (v: number) => void;
  onResetRedeemed: () => void;       // clear the user override → fall back to autoComputed
}

export default function RouteOrderPointsEditor({
  currency,
  autoComputed,
  redeemed,
  onChangeRedeemed,
  onResetRedeemed,
}: Props) {
  const { getToken } = useAuth();
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftBalance, setDraftBalance] = useState<string>("");

  const fetchBalance = async () => {
    setLoading(true);
    try {
      const token = await getToken();
      const res = await request(
        { path: "/organizations/points-balance", method: "GET" },
        {},
        token ?? undefined,
      );
      const v = Number(res?.data?.balance ?? res?.balance);
      if (Number.isFinite(v)) setBalance(v);
    } catch (err) {
      console.warn("Failed to fetch points balance:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBalance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveBalance = async () => {
    const next = Math.max(0, parseFloat(draftBalance) || 0);
    try {
      const token = await getToken();
      const res = await request(
        { path: "/organizations/points-balance", method: "PATCH" },
        { balance: next },
        token ?? undefined,
      );
      const v = Number(res?.data?.balance ?? res?.balance);
      if (Number.isFinite(v)) setBalance(v);
      setEditing(false);
      toast.success(`Points balance set to ${next.toLocaleString()}`);
    } catch (err) {
      console.error("Failed to save points balance:", err);
      toast.error("Failed to save points balance");
    }
  };

  const cancelEditBalance = () => {
    setDraftBalance("");
    setEditing(false);
  };
  const startEditBalance = () => {
    setDraftBalance(String(balance ?? 0));
    setEditing(true);
  };

  const overridden = redeemed !== autoComputed;
  const projected = balance != null ? balance - redeemed : null;

  return (
    <Box sx={{ mt: 0.5, mb: 0.5 }}>
      {/* Less Points row — editable number field. */}
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.5 }}>
        <Typography variant="body2">Less Points:</Typography>
        <Stack direction="row" alignItems="center" spacing={0.5}>
          {overridden && (
            <Tooltip arrow title={`Reset to auto-computed (${autoComputed.toLocaleString()})`}>
              <IconButton size="small" onClick={onResetRedeemed} sx={{ p: 0.25 }}>
                <RestoreIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
          )}
          <Typography variant="body2" color="error.main" sx={{ mr: 0.5 }}>-{currency}</Typography>
          <TextField
            type="number"
            size="small"
            value={redeemed}
            onChange={(e) => onChangeRedeemed(Math.max(0, Number(e.target.value) || 0))}
            inputProps={{ min: 0, step: 1, style: { textAlign: "right", width: 80, padding: "4px 6px", fontSize: "0.8125rem" } }}
            sx={{ "& .MuiOutlinedInput-root": { height: 28 } }}
          />
        </Stack>
      </Stack>

      {/* Balance + projected. */}
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.25 }}>
        <Typography variant="caption" color="text.secondary">Balance:</Typography>
        {editing ? (
          <Stack direction="row" alignItems="center" spacing={0.5}>
            <TextField
              type="number"
              size="small"
              value={draftBalance}
              onChange={(e) => setDraftBalance(e.target.value)}
              inputProps={{ min: 0, step: 1, style: { textAlign: "right", width: 100, padding: "4px 6px", fontSize: "0.75rem" } }}
              sx={{ "& .MuiOutlinedInput-root": { height: 26 } }}
              autoFocus
            />
            <IconButton size="small" onClick={saveBalance} sx={{ p: 0.25, color: "success.main" }}>
              <CheckIcon sx={{ fontSize: 14 }} />
            </IconButton>
            <IconButton size="small" onClick={cancelEditBalance} sx={{ p: 0.25 }}>
              <CloseIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Stack>
        ) : (
          <Stack direction="row" alignItems="center" spacing={0.5}>
            <Typography variant="caption" color="text.secondary">
              {loading ? "…" : balance != null ? balance.toLocaleString() : "—"}
            </Typography>
            <Tooltip arrow title="Edit balance">
              <IconButton size="small" onClick={startEditBalance} sx={{ p: 0.25 }}>
                <EditIcon sx={{ fontSize: 13 }} />
              </IconButton>
            </Tooltip>
          </Stack>
        )}
      </Stack>

      {projected != null && (
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Typography variant="caption" color={projected < 0 ? "error.main" : "text.secondary"}>
            After confirm:
          </Typography>
          <Typography variant="caption" color={projected < 0 ? "error.main" : "text.secondary"}>
            {projected.toLocaleString()}
          </Typography>
        </Stack>
      )}

      {/* Spacer below so the GST row that follows doesn't crowd. */}
      <Box sx={{ height: 4 }} />
    </Box>
  );
}
