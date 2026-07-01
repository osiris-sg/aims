"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
  alpha,
} from "@mui/material";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import LockIcon from "@mui/icons-material/Lock";

// Shared AI posting-preview dialog, used by both the bill editor (accounts keyed
// by id) and the invoice editor (accounts keyed by code). The user reviews
// Claude's per-line account picks, can re-assign the account on any editable
// line, then confirms. Control lines (AR / AP / GST) are resolved from
// Accounting Setup and shown locked. Amounts come from the document, so the
// entry is balanced by construction. Confirm applies the chosen accounts back
// onto the document — it does NOT post.

export type PreviewLine = {
  role: "receivable" | "payable" | "line" | "tax";
  lineIndex?: number;
  accountId: string | null;
  accountCode: string | null;
  accountName: string | null;
  debit: number;
  credit: number;
  description: string;
  source: "existing" | "ai" | "learned" | "fallback" | "control";
  confidence?: number;
  reason?: string;
};

export type PreviewResult = {
  lines: PreviewLine[];
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
  warnings: string[];
};

export type PreviewAccount = { id?: string; code: string; name: string };

const fmt = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function PostingPreviewDialog({
  open,
  loading,
  preview,
  accounts,
  title = "Review accounts",
  onClose,
  onConfirm,
  onLearn,
}: {
  open: boolean;
  loading: boolean;
  preview: PreviewResult | null;
  accounts: PreviewAccount[];
  title?: string;
  onClose: () => void;
  onConfirm: (picks: Array<{ lineIndex: number; accountId: string | null; accountCode: string | null }>) => void;
  // Called with the lines the user re-coded (chosen account ≠ what was suggested)
  // so the backend can learn description → account. Fire-and-forget.
  onLearn?: (corrections: Array<{ text: string; accountCode: string }>) => void;
}) {
  // Local override of the account per editable line, keyed by lineIndex → code.
  const [codeByLine, setCodeByLine] = useState<Record<number, string | null>>({});

  useEffect(() => {
    if (!preview) return;
    const init: Record<number, string | null> = {};
    for (const l of preview.lines) {
      if (l.role === "line" && l.lineIndex != null) init[l.lineIndex] = l.accountCode;
    }
    setCodeByLine(init);
  }, [preview]);

  const acctByCode = useMemo(() => new Map(accounts.map((a) => [a.code, a])), [accounts]);

  const unassigned = preview
    ? preview.lines.filter((l) => l.role === "line" && !(l.lineIndex != null && codeByLine[l.lineIndex])).length
    : 0;
  const canConfirm = !!preview && preview.balanced && unassigned === 0;

  const handleConfirm = () => {
    if (!preview) return;
    const picks = preview.lines
      .filter((l) => l.role === "line" && l.lineIndex != null)
      .map((l) => {
        const code = codeByLine[l.lineIndex as number] ?? null;
        const acct = code ? acctByCode.get(code) : undefined;
        return { lineIndex: l.lineIndex as number, accountCode: code, accountId: acct?.id ?? null };
      });
    // Teach the memory: lines where the chosen account differs from what was
    // suggested (the accountant overrode the AI/learned pick).
    if (onLearn) {
      const corrections = preview.lines
        .filter((l) => l.role === "line" && l.lineIndex != null)
        .filter((l) => {
          const chosen = codeByLine[l.lineIndex as number] ?? null;
          return chosen && chosen !== l.accountCode && (l.description || "").trim();
        })
        .map((l) => ({ text: l.description, accountCode: codeByLine[l.lineIndex as number] as string }));
      if (corrections.length) onLearn(corrections);
    }
    onConfirm(picks);
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>
        <Stack direction="row" gap={1.25} alignItems="center">
          <AutoAwesomeIcon sx={{ color: "primary.main" }} />
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            {title}
          </Typography>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            AI-suggested journal entry — adjust accounts, then apply them
          </Typography>
        </Stack>
      </DialogTitle>

      <DialogContent dividers>
        {loading && (
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1.5, p: 5 }}>
            <CircularProgress size={20} />
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              Asking AI to categorize the lines…
            </Typography>
          </Box>
        )}

        {!loading && preview && (
          <>
            {preview.warnings.length > 0 && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                {preview.warnings.map((w, i) => (
                  <div key={i}>{w}</div>
                ))}
              </Alert>
            )}

            <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, overflow: "hidden" }}>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: (t: any) => alpha(t.palette.text.primary, 0.03) }}>
                    <TableCell sx={{ fontWeight: 700, width: 300 }}>Account</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Description</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700, width: 110 }}>Debit</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700, width: 110 }}>Credit</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {preview.lines.map((l, idx) => {
                    const editable = l.role === "line" && l.lineIndex != null;
                    const selected = editable ? acctByCode.get(codeByLine[l.lineIndex as number] ?? "") ?? null : null;
                    return (
                      <TableRow key={idx}>
                        <TableCell>
                          {editable ? (
                            <Stack direction="row" gap={0.75} alignItems="center">
                              <Autocomplete
                                size="small"
                                fullWidth
                                options={accounts}
                                value={selected}
                                onChange={(_, v) =>
                                  setCodeByLine((m) => ({ ...m, [l.lineIndex as number]: v?.code || null }))
                                }
                                getOptionLabel={(o) => `${o.code} — ${o.name}`}
                                isOptionEqualToValue={(o, v) => o.code === v.code}
                                renderInput={(params) => <TextField {...params} placeholder="Pick account" />}
                                sx={{ minWidth: 240 }}
                              />
                              {l.source === "ai" && (
                                <Tooltip title={l.reason || "AI suggestion"}>
                                  <Chip
                                    size="small"
                                    color="primary"
                                    variant="outlined"
                                    icon={<AutoAwesomeIcon sx={{ fontSize: 14 }} />}
                                    label={l.confidence != null ? `${Math.round(l.confidence * 100)}%` : "AI"}
                                    sx={{ height: 22 }}
                                  />
                                </Tooltip>
                              )}
                              {l.source === "learned" && (
                                <Tooltip title={l.reason || "Learned from your past coding"}>
                                  <Chip
                                    size="small"
                                    color="success"
                                    variant="outlined"
                                    icon={<AutoAwesomeIcon sx={{ fontSize: 14 }} />}
                                    label="learned"
                                    sx={{ height: 22 }}
                                  />
                                </Tooltip>
                              )}
                              {l.source === "fallback" && (
                                <Tooltip title={l.reason || "Default account — AI had no suggestion"}>
                                  <Chip size="small" variant="outlined" label="default" sx={{ height: 22 }} />
                                </Tooltip>
                              )}
                            </Stack>
                          ) : (
                            <Stack direction="row" gap={0.75} alignItems="center">
                              <Tooltip title="Control account — set in Accounting Setup">
                                <LockIcon sx={{ fontSize: 14, color: "text.disabled" }} />
                              </Tooltip>
                              <Typography variant="body2">
                                {l.accountCode ? `${l.accountCode} — ${l.accountName}` : (
                                  <span style={{ color: "#d32f2f" }}>{l.accountName || "(unresolved)"}</span>
                                )}
                              </Typography>
                            </Stack>
                          )}
                        </TableCell>
                        <TableCell sx={{ color: "text.secondary", fontSize: "0.8rem" }}>
                          <Tooltip title={l.description || ""} placement="top-start">
                            <Box
                              sx={{
                                display: "-webkit-box",
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: "vertical",
                                overflow: "hidden",
                                maxWidth: 380,
                              }}
                            >
                              {l.description}
                            </Box>
                          </Tooltip>
                        </TableCell>
                        <TableCell align="right" sx={{ fontFamily: "monospace" }}>
                          {l.debit > 0 ? fmt(l.debit) : ""}
                        </TableCell>
                        <TableCell align="right" sx={{ fontFamily: "monospace" }}>
                          {l.credit > 0 ? fmt(l.credit) : ""}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Box>

            <Stack direction="row" alignItems="center" gap={2} sx={{ mt: 1.5 }}>
              <Box sx={{ flex: 1 }}>
                {preview.balanced ? (
                  <Chip size="small" color="success" label="Balanced" variant="outlined" />
                ) : (
                  <Chip size="small" color="error" label="Out of balance" />
                )}
                {unassigned > 0 && (
                  <Typography variant="caption" sx={{ color: "warning.main", ml: 1.5 }}>
                    {unassigned} line{unassigned === 1 ? "" : "s"} still need an account
                  </Typography>
                )}
              </Box>
              <Typography variant="body2" sx={{ color: "text.secondary" }}>Total Dr</Typography>
              <Typography sx={{ fontFamily: "monospace", fontWeight: 700, minWidth: 100, textAlign: "right" }}>
                {fmt(preview.totalDebit)}
              </Typography>
              <Typography variant="body2" sx={{ color: "text.secondary" }}>Total Cr</Typography>
              <Typography sx={{ fontFamily: "monospace", fontWeight: 700, minWidth: 100, textAlign: "right" }}>
                {fmt(preview.totalCredit)}
              </Typography>
            </Stack>
          </>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleConfirm} disabled={!canConfirm}>
          Confirm
        </Button>
      </DialogActions>
    </Dialog>
  );
}
