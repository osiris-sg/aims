"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Alert, Box, Button, Chip, CircularProgress, Stack, Typography } from "@mui/material";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdf";
import { request } from "@/helpers/request";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";

/**
 * Run page: "Download signed DO" for each DO on the run (rendered now, exactly
 * as the field app prints it), and, with enableDeliveryGroupPosts, the
 * "Posted to group" line per sign-off with a retry for a failed or skipped one.
 */
interface Post {
  id: string;
  status: string;
  tripNumber: number;
  final: boolean;
  groupName: string | null;
  signedAt: string;
  sentAt: string | null;
  error: string | null;
}

const fmt = (d: string | null) =>
  d ? new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }) : "";

const STATUS: Record<string, { label: string; color: "default" | "success" | "warning" | "error" | "info" }> = {
  PENDING: { label: "Preparing the signed DO", color: "info" },
  RENDERING: { label: "Preparing the signed DO", color: "info" },
  READY: { label: "Waiting to post", color: "info" },
  CLAIMED: { label: "Posting", color: "info" },
  SENT: { label: "Posted", color: "success" },
  FAILED: { label: "Not posted", color: "error" },
  SKIPPED: { label: "Not posted", color: "warning" },
};

export default function DeliveryGroupPostsPanel({
  deliveryId,
  documents,
  signed,
}: {
  deliveryId: string;
  documents: Array<{ id: string; name: string | null }>;
  /** The run has at least one customer sign-off (partial or final). */
  signed: boolean;
}) {
  const { getToken } = useAuth();
  const { isDeliveryGroupPostsEnabled } = useOrganizationFeatures();
  const [posts, setPosts] = useState<Post[]>([]);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const token = (await getToken()) ?? undefined;
      const res = await request({ path: `/delivery-group-posts/delivery/${deliveryId}`, method: "GET" }, {}, token);
      if (Array.isArray(res?.data ?? res)) setPosts(res?.data ?? res);
    } catch {
      /* the post line is informational */
    }
  }, [deliveryId, getToken]);

  useEffect(() => {
    if (isDeliveryGroupPostsEnabled) void load();
  }, [isDeliveryGroupPostsEnabled, load]);

  const download = async (doc: { id: string; name: string | null }) => {
    setDownloading(doc.id);
    setError(null);
    try {
      const token = (await getToken()) ?? undefined;
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      const activeOrg = typeof window !== "undefined" ? window.sessionStorage.getItem("aims-admin-active-org") : null;
      if (activeOrg) headers["X-Active-Org-Id"] = activeOrg;
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_API_URL}/delivery-group-posts/delivery/${deliveryId}/signed-do?documentId=${doc.id}`,
        { headers },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message || `Download failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(doc.name || "DO").replace(/[^a-zA-Z0-9._-]/g, "_")}-signed.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e: any) {
      setError(e?.message ?? "Could not download the signed DO");
    } finally {
      setDownloading(null);
    }
  };

  const retry = async (id: string) => {
    setRetrying(id);
    setError(null);
    try {
      const token = (await getToken()) ?? undefined;
      const res = await request({ path: `/delivery-group-posts/${id}/retry`, method: "POST" }, {}, token);
      if (res?.success === false) throw new Error(res.message ?? "Could not retry");
      await load();
    } catch (e: any) {
      setError(e?.message ?? "Could not retry");
    } finally {
      setRetrying(null);
    }
  };

  if (!signed && !posts.length) return null;

  return (
    <Box sx={{ mb: 2 }}>
      {signed && documents.length > 0 && (
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: posts.length ? 1 : 0 }}>
          {documents.map((d) => (
            <Button
              key={d.id}
              size="small"
              variant="outlined"
              startIcon={downloading === d.id ? <CircularProgress size={14} /> : <PictureAsPdfIcon />}
              disabled={!!downloading}
              onClick={() => void download(d)}
            >
              Download signed DO{documents.length > 1 && d.name ? ` ${d.name}` : ""}
            </Button>
          ))}
        </Stack>
      )}
      {isDeliveryGroupPostsEnabled &&
        posts.map((p) => {
          const st = STATUS[p.status] ?? { label: p.status, color: "default" as const };
          return (
            <Stack key={p.id} direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 0.5 }}>
              <WhatsAppIcon fontSize="small" sx={{ color: p.status === "SENT" ? "success.main" : "text.disabled" }} />
              <Typography variant="body2">
                {p.status === "SENT"
                  ? `Posted to group ${p.groupName ?? ""} · ${fmt(p.sentAt)}`
                  : p.groupName
                    ? `Group ${p.groupName}`
                    : "No WhatsApp group"}
                {` · Trip ${p.tripNumber}${p.final ? " (final)" : ""}`}
              </Typography>
              {p.status !== "SENT" && <Chip size="small" variant="outlined" color={st.color} label={st.label} />}
              {(p.status === "FAILED" || p.status === "SKIPPED") && (
                <>
                  {p.error && (
                    <Typography variant="caption" color="text.secondary">
                      {p.error}
                    </Typography>
                  )}
                  <Button size="small" disabled={retrying === p.id} onClick={() => void retry(p.id)}>
                    Retry
                  </Button>
                </>
              )}
            </Stack>
          );
        })}
      {error && (
        <Alert severity="error" sx={{ mt: 1 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
    </Box>
  );
}
