"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Link as MuiLink,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import ReplayIcon from "@mui/icons-material/Replay";
import { request } from "@/helpers/request";

/**
 * Admin uploads log — the org-scoped record of every /submit intake job
 * (QUEUED / PROCESSING / DONE / FAILED). This is where server-side extraction
 * failures land VISIBLY (a FAILED extraction creates no Document, so it can't
 * appear in the posting queue). Failed rows carry the reason + a manual retry.
 */

interface Job {
  id: string;
  batchId: string;
  docType: string;
  status: "QUEUED" | "PROCESSING" | "DONE" | "FAILED";
  fileName: string | null;
  fileUrl: string | null;
  reason: string | null;
  documentId: string | null;
  createdByUserId: string;
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
}

const CHIP: Record<Job["status"], "default" | "info" | "success" | "error"> = {
  QUEUED: "default",
  PROCESSING: "info",
  DONE: "success",
  FAILED: "error",
};

const STATUSES = ["", "QUEUED", "PROCESSING", "DONE", "FAILED"];

export default function AdminUploadsPage() {
  const { getToken } = useAuth();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [retrying, setRetrying] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) {
        setError("Not signed in");
        return;
      }
      const q = status ? `?status=${status}` : "";
      const res = await request({ path: `/submit/jobs${q}`, method: "GET" }, {}, token);
      if (res?.success === false) throw new Error(res.message ?? "Failed to load");
      setJobs(((res.data ?? res) as Job[]) ?? []);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load uploads");
    } finally {
      setLoading(false);
    }
  }, [getToken, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const retry = async (id: string) => {
    setRetrying(id);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await request({ path: `/submit/jobs/${id}/retry`, method: "POST" }, {}, token);
      if (res?.success === false) throw new Error(res.message ?? "Retry failed");
      await load();
    } catch (e: any) {
      setError(e?.message ?? "Retry failed");
    } finally {
      setRetrying(null);
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2 }}>
        <Typography variant="h5" fontWeight={700} sx={{ flex: 1 }}>
          Uploads log
        </Typography>
        <TextField select size="small" label="Status" value={status} onChange={(e) => setStatus(e.target.value)} sx={{ minWidth: 160 }}>
          {STATUSES.map((s) => (
            <MenuItem key={s || "all"} value={s}>
              {s || "All"}
            </MenuItem>
          ))}
        </TextField>
        <Button startIcon={<RefreshIcon />} onClick={() => void load()} disabled={loading}>
          Refresh
        </Button>
      </Stack>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Documents submitted from the field /submit app. Failed extractions show the reason and can be retried (the original
        file is kept).
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
          <CircularProgress />
        </Box>
      ) : jobs.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: "center" }}>
          No submissions{status ? ` with status ${status}` : ""}.
        </Typography>
      ) : (
        <TableContainer component={Paper} variant="outlined" sx={{ overflowX: "auto" }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>When</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>File</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Reason / result</TableCell>
                <TableCell align="right">Attempts</TableCell>
                <TableCell align="right">Action</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {jobs.map((j) => (
                <TableRow key={j.id} hover>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>
                    {new Date(j.createdAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </TableCell>
                  <TableCell>{j.docType}</TableCell>
                  <TableCell sx={{ maxWidth: 220 }}>
                    {j.fileUrl ? (
                      <MuiLink href={j.fileUrl} target="_blank" rel="noopener" noWrap sx={{ display: "block", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {j.fileName || "file"}
                      </MuiLink>
                    ) : (
                      <Typography variant="body2" noWrap>{j.fileName || "—"}</Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip size="small" label={j.status} color={CHIP[j.status] ?? "default"} />
                  </TableCell>
                  <TableCell sx={{ maxWidth: 320 }}>
                    {j.status === "FAILED" ? (
                      <Typography variant="caption" color="error">{j.reason}</Typography>
                    ) : j.documentId ? (
                      <Typography variant="caption" color="text.secondary">draft created</Typography>
                    ) : (
                      <Typography variant="caption" color="text.secondary">—</Typography>
                    )}
                  </TableCell>
                  <TableCell align="right">{j.attemptCount}</TableCell>
                  <TableCell align="right">
                    {(j.status === "FAILED" || j.status === "QUEUED") && (
                      <Button
                        size="small"
                        startIcon={retrying === j.id ? <CircularProgress size={14} /> : <ReplayIcon />}
                        onClick={() => void retry(j.id)}
                        disabled={retrying !== null}
                      >
                        Retry
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}
