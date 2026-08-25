"use client";

import React, { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import BlockIcon from "@mui/icons-material/Block";
import AutorenewIcon from "@mui/icons-material/Autorenew";
import { useAuth } from "@clerk/nextjs";
import { toast } from "react-toastify";
import MainCard from "@/components/MainCard";
import { request } from "@/helpers/request";
import { ROUTES } from "@/routes";
import {
  useGetCustomerInfoRequest,
  CustomerInfoContact,
} from "@/app/portal/hooks/api/useCustomerInfo";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://www.ai-ms.io";

const STATUS_CHIP: Record<string, { label: string; color: "default" | "warning" | "success" | "error" }> = {
  awaiting: { label: "Awaiting response", color: "warning" },
  submitted: { label: "Submitted", color: "success" },
  expired: { label: "Expired", color: "default" },
  revoked: { label: "Revoked", color: "error" },
};

function ContactTable({ title, rows }: { title: string; rows: CustomerInfoContact[] }) {
  return (
    <Box>
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
        {title}
      </Typography>
      {rows.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No contacts collected yet.
        </Typography>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Email</TableCell>
              <TableCell>Phone</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((c) => (
              <TableRow key={c.id}>
                <TableCell>{c.name}</TableCell>
                <TableCell>{c.email || "-"}</TableCell>
                <TableCell>{c.phone || "-"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Box>
  );
}

export default function CustomerInfoDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { getToken } = useAuth();
  const id = params?.id as string;
  const { detail, isLoading, refetch } = useGetCustomerInfoRequest(id);
  const [busy, setBusy] = useState(false);

  const shareUrl = detail ? `${APP_URL}/guest/customer-info/${detail.token}` : "";
  const isActive = detail ? detail.status !== "revoked" : false;

  const copyUrl = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success("Link copied");
    } catch {
      toast.info("Copy failed. Select the link and copy it manually.");
    }
  };

  const handleRevoke = async () => {
    if (!detail) return;
    if (!window.confirm("Revoke this link? The customer will no longer be able to open it.")) return;
    setBusy(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await request({ path: `/customer-info/${detail.id}/revoke`, method: "POST" }, {}, token);
      if (res?.success === false) throw new Error(res?.message ?? "Failed to revoke");
      toast.success("Link revoked");
      refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to revoke");
    } finally {
      setBusy(false);
    }
  };

  const handleRegenerate = async () => {
    if (!detail) return;
    if (!window.confirm("Generate a fresh link? The current link stops working and a new 30-day link is created.")) return;
    setBusy(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await request({ path: `/customer-info/${detail.id}/regenerate`, method: "POST" }, {}, token);
      const data = res?.data ?? res;
      if (res?.success === false || !data?.id) throw new Error(res?.message ?? "Failed to regenerate");
      toast.success("New link generated");
      router.push(`${ROUTES.CUSTOMER_INFORMATION}/${data.id}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to regenerate");
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) {
    return (
      <MainCard>
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
          <CircularProgress />
        </Box>
      </MainCard>
    );
  }

  if (!detail) {
    return (
      <MainCard>
        <Button startIcon={<ArrowBackIcon />} onClick={() => router.push(ROUTES.CUSTOMER_INFORMATION)}>
          Back
        </Button>
        <Alert severity="error" sx={{ mt: 2 }}>
          This customer information request was not found.
        </Alert>
      </MainCard>
    );
  }

  const chip = STATUS_CHIP[detail.status] ?? { label: detail.status, color: "default" as const };

  return (
    <MainCard>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => router.push(ROUTES.CUSTOMER_INFORMATION)}>
          Back
        </Button>
        <Chip size="small" label={chip.label} color={chip.color} variant={chip.color === "default" ? "outlined" : "filled"} />
      </Stack>

      {/* Read-only header */}
      <Typography variant="h6" fontWeight={700}>
        {detail.projectName}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {detail.customerName}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
        Created {new Date(detail.createdAt).toLocaleString()}
        {detail.submittedAt ? ` | Last submitted ${new Date(detail.submittedAt).toLocaleString()}` : " | Awaiting response"}
        {detail.submissionCount > 1 ? ` (${detail.submissionCount} submissions)` : ""}
      </Typography>

      {/* Share link + actions */}
      <Box sx={{ mt: 2, mb: 1 }}>
        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
          Shareable link
        </Typography>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }}>
          <TextField value={shareUrl} fullWidth size="small" InputProps={{ readOnly: true }} />
          <Stack direction="row" spacing={1}>
            <Tooltip title="Copy link">
              <span>
                <IconButton onClick={copyUrl} color="primary" disabled={!isActive}>
                  <ContentCopyIcon />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Regenerate (new link, revokes this one)">
              <span>
                <IconButton onClick={handleRegenerate} disabled={busy}>
                  <AutorenewIcon />
                </IconButton>
              </span>
            </Tooltip>
            {isActive && (
              <Tooltip title="Revoke link">
                <span>
                  <IconButton onClick={handleRevoke} disabled={busy} sx={{ "&:hover": { color: "error.main" } }}>
                    <BlockIcon />
                  </IconButton>
                </span>
              </Tooltip>
            )}
          </Stack>
        </Stack>
        {!isActive && (
          <Typography variant="caption" color="error.main" sx={{ display: "block", mt: 0.5 }}>
            This link is revoked. Regenerate to send the customer a fresh one.
          </Typography>
        )}
      </Box>

      <Divider sx={{ my: 2 }} />

      <Stack spacing={3}>
        <ContactTable title="Delivery Order (DO) contacts" rows={detail.doContacts} />
        <ContactTable title="Invoice contacts" rows={detail.invoiceContacts} />
      </Stack>
    </MainCard>
  );
}
