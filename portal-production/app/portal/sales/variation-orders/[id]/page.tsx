"use client";

// Standalone Variation Order view (guru 2026-10-07: "when I view a VO it jumps
// to the project VO page, which is wrong — same template as the quotation").
// Shows the VO rendered in the firm's quotation-family print layout (the
// server's /documents/:id/html), paper-on-grey, with Print and a jump to the
// project's VO sheet for editing.

import React, { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Box, Button, Chip, CircularProgress, Stack, Typography } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import EditIcon from "@mui/icons-material/EditOutlined";
import PrintIcon from "@mui/icons-material/PrintOutlined";
import AccountTreeIcon from "@mui/icons-material/AccountTreeOutlined";
import DrawIcon from "@mui/icons-material/DrawOutlined";
import MainCard from "@/components/MainCard";
import StatusChip from "@/components/StatusChip";
import { useIdQuoteApi } from "../../quotations/id/_lib/api";
import { useUserPermissions } from "@/app/portal/hooks/useUserPermissions";
import { toast } from "react-toastify";
import SignLinkDialog from "../../quotations/id/_components/SignLinkDialog";

export default function VariationOrderViewPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  // Directors (master tier) may revert a confirmed VO back to draft (Mike
  // 2026-10-21 video: the button only lived on the project VO table).
  const { userRoles } = useUserPermissions();
  const isDirector = userRoles.length === 0 || userRoles.some((r: any) => !["Designer", "Marketing", "Junior Manager", "Senior Manager"].includes(r?.name));
  const api = useIdQuoteApi();
  const [doc, setDoc] = useState<any>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Send the homeowner the e-sign link (Mike 2026-11-07) — draft VOs only;
  // signing confirms the VO and adds its net to the contract sum.
  const [signOpen, setSignOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const [d, h] = await Promise.all([api.request<any>(`/documents/${id}`), api.request<{ html: string }>(`/documents/${id}/html`)]);
      setDoc(d);
      // Paper-on-grey preview chrome (print strips it) — same as the schedule preview.
      const previewCss = `<style>
        @media screen {
          body { background: #525659 !important; padding: 20px 16px 32px; }
          .preview-paper { background: #fff; max-width: 920px; margin: 0 auto; padding: 24px 28px; box-shadow: 0 2px 14px rgba(0,0,0,.45); border-radius: 2px; }
        }
        @media print { .preview-paper { background: none; max-width: none; margin: 0; padding: 0; box-shadow: none; } }
      </style>`;
      const wrapped = (h?.html || "").replace("</head>", `${previewCss}</head>`).replace(/<body([^>]*)>/i, '<body$1><div class="preview-paper">').replace(/<\/body>/i, "</div></body>");
      setHtml(wrapped);
    } catch (e: any) {
      setError(e.message || "Could not load the variation order");
    }
  }, [api, id]);
  useEffect(() => {
    load();
  }, [load]);

  if (error)
    return (
      <MainCard>
        <Typography color="error">{error}</Typography>
      </MainCard>
    );

  return (
    <Box sx={{ width: "100%", display: "flex", flexDirection: "column", minHeight: "calc(100vh - 120px)" }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5, flexWrap: "wrap", rowGap: 1 }}>
        <Button size="small" startIcon={<ArrowBackIcon />} onClick={() => router.back()} sx={{ textTransform: "none" }}>
          Back
        </Button>
        <Typography variant="h6" sx={{ fontWeight: 800 }}>
          {doc?.name || "Variation Order"}
        </Typography>
        {doc && <StatusChip status={doc.status} />}
        {doc?.projectId && (
          <Chip size="small" variant="outlined" icon={<AccountTreeIcon />} label="Open project" onClick={() => router.push(`/portal/projects/${doc.projectId}`)} sx={{ height: 22 }} />
        )}
        <Box sx={{ flex: 1 }} />
        {doc?.status === "confirmed" && isDirector && (
          <Button
            size="small"
            variant="outlined"
            color="warning"
            onClick={async () => {
              if (!window.confirm(`Revert ${doc?.name || "this VO"} to draft? Its net amount comes off the contract sum and its payment line is removed.`)) return;
              try {
                await api.request(`/projects/vo/${id}/revert`, { method: "POST" });
                toast.success(`${doc?.name || "VO"} reverted to draft`);
                load();
              } catch (err: any) {
                toast.error(err.message || "Could not revert the VO");
              }
            }}
            sx={{ textTransform: "none" }}
          >
            Revert to draft
          </Button>
        )}
        {doc && doc.status !== "confirmed" && (
          <Button size="small" variant="outlined" startIcon={<DrawIcon />} onClick={() => setSignOpen(true)} sx={{ textTransform: "none" }}>
            Send for signature
          </Button>
        )}
        {doc?.projectId && (
          <Button size="small" variant="outlined" startIcon={<EditIcon />} onClick={() => router.push(`/portal/projects/${doc.projectId}?vo=${id}`)} sx={{ textTransform: "none" }}>
            Edit in VO sheet
          </Button>
        )}
        <Button
          size="small"
          variant="contained"
          startIcon={<PrintIcon />}
          disabled={!html}
          onClick={() => (document.getElementById("vo-view-frame") as HTMLIFrameElement | null)?.contentWindow?.print()}
          sx={{ textTransform: "none" }}
        >
          Print / Save PDF
        </Button>
      </Stack>
      {html ? (
        <iframe id="vo-view-frame" title="Variation order" srcDoc={html} sandbox="allow-same-origin allow-modals" style={{ width: "100%", flex: 1, minHeight: 640, border: 0, borderRadius: 8, background: "#525659" }} />
      ) : (
        <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
          <CircularProgress />
        </Box>
      )}
      {doc && (
        <SignLinkDialog
          open={signOpen}
          kind="vo"
          documentId={doc.id}
          documentNumber={doc.name || null}
          clientName={doc.config?.client?.name || ""}
          clientPhone={""}
          grandTotal={(() => {
            const vo = doc.config?.vo || {};
            const s = (list: any[]) => (Array.isArray(list) ? list : []).reduce((n, l) => n + (l?.kind === "area" || l?.complimentary || l?.struck ? 0 : Number(l?.amount) || 0), 0);
            return s(vo.additions) - s(vo.removals);
          })()}
          onClose={() => {
            setSignOpen(false);
            // The homeowner may have signed while the dialog was open.
            load();
          }}
        />
      )}
    </Box>
  );
}
