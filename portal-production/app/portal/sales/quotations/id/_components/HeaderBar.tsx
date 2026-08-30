"use client";

import React from "react";
import { Box, Button, Chip, IconButton, Stack, Switch, Tooltip, Typography, useMediaQuery, useTheme } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import VisibilityIcon from "@mui/icons-material/VisibilityOutlined";
import CheckCircleIcon from "@mui/icons-material/CheckCircleOutline";
import CloudDoneIcon from "@mui/icons-material/CloudDoneOutlined";
import CloudSyncIcon from "@mui/icons-material/CloudSyncOutlined";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import MenuIcon from "@mui/icons-material/Menu";
import DrawIcon from "@mui/icons-material/DrawOutlined";
import AccountTreeIcon from "@mui/icons-material/AccountTreeOutlined";
import StatusChip from "@/components/StatusChip";

export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error" | "conflict";

interface Props {
  number: string | null;
  clientName: string;
  status: string;
  saveState: SaveState;
  internalView: boolean;
  onInternalView: (v: boolean) => void;
  readOnly: boolean;
  onBack: () => void;
  onPreview: () => void;
  onConfirm: () => void;
  onSaveNow: () => void;
  onToggleRail: () => void;
  onSendForSignature: () => void;
  signedBy?: { name: string | null; signedAt: string } | null;
  project?: { id: string; name: string } | null;
  onOpenProject?: () => void;
}

const SAVE_LABEL: Record<SaveState, { text: string; icon: React.ReactNode; color: string }> = {
  idle: { text: "All changes saved", icon: <CloudDoneIcon fontSize="small" />, color: "text.secondary" },
  saved: { text: "Saved", icon: <CloudDoneIcon fontSize="small" />, color: "success.main" },
  dirty: { text: "Unsaved changes", icon: <CloudSyncIcon fontSize="small" />, color: "text.secondary" },
  saving: { text: "Saving…", icon: <CloudSyncIcon fontSize="small" />, color: "text.secondary" },
  error: { text: "Save failed — retrying", icon: <ErrorOutlineIcon fontSize="small" />, color: "error.main" },
  conflict: { text: "Updated elsewhere — reload", icon: <ErrorOutlineIcon fontSize="small" />, color: "error.main" },
};

export default function HeaderBar({ number, clientName, status, saveState, internalView, onInternalView, readOnly, onBack, onPreview, onConfirm, onSaveNow, onToggleRail, onSendForSignature, signedBy, project, onOpenProject }: Props) {
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down("md"));
  const save = SAVE_LABEL[saveState];

  return (
    <Box
      sx={{
        position: "sticky",
        top: 0,
        zIndex: 20,
        bgcolor: "background.paper",
        borderBottom: 1,
        borderColor: "divider",
        px: { xs: 1.5, md: 3 },
        py: 1,
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        flexWrap: "wrap",
      }}
    >
      {compact && (
        <IconButton size="small" onClick={onToggleRail} aria-label="Sections">
          <MenuIcon />
        </IconButton>
      )}
      <IconButton size="small" onClick={onBack} aria-label="Back">
        <ArrowBackIcon />
      </IconButton>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2, whiteSpace: "nowrap" }}>
            {number || "New quotation"}
          </Typography>
          <StatusChip status={status} />
        </Stack>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
          <Typography variant="caption" sx={{ color: "text.secondary", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {clientName || "No client yet"}
          </Typography>
          {signedBy && (
            <Chip size="small" color="success" variant="outlined" icon={<DrawIcon />} label={`Signed by ${signedBy.name || clientName} · ${new Date(signedBy.signedAt).toLocaleDateString("en-SG", { day: "2-digit", month: "short" })}`} sx={{ height: 20, "& .MuiChip-label": { fontSize: 11 } }} />
          )}
          {project && (
            <Chip size="small" variant="outlined" icon={<AccountTreeIcon />} label={project.name} onClick={onOpenProject} sx={{ height: 20, maxWidth: 260, "& .MuiChip-label": { fontSize: 11 } }} />
          )}
        </Stack>
      </Box>

      <Tooltip title={saveState === "conflict" ? "Someone else saved this quotation. Reload to continue." : ""}>
        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color: save.color, cursor: saveState === "dirty" ? "pointer" : "default" }} onClick={saveState === "dirty" ? onSaveNow : undefined}>
          {save.icon}
          {!compact && <Typography variant="caption">{save.text}</Typography>}
        </Stack>
      </Tooltip>

      <Tooltip title="Show cost & margin columns (never printed)">
        <Stack direction="row" spacing={0.5} alignItems="center">
          <Switch size="small" checked={internalView} onChange={(e) => onInternalView(e.target.checked)} data-tour="idq-internal-toggle" />
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            Internal
          </Typography>
        </Stack>
      </Tooltip>

      <Button size="small" variant="outlined" startIcon={<VisibilityIcon />} onClick={onPreview} data-tour="idq-preview">
        Preview
      </Button>
      {!readOnly ? (
        <>
          <Button size="small" variant="outlined" startIcon={<DrawIcon />} onClick={onSendForSignature} data-tour="idq-send-signature">
            {compact ? "Sign" : "Send for signature"}
          </Button>
          <Tooltip title="Confirm without a client signature (e.g. signed on paper)">
            <Button size="small" variant="contained" startIcon={<CheckCircleIcon />} onClick={onConfirm} data-tour="idq-confirm">
              Confirm
            </Button>
          </Tooltip>
        </>
      ) : (
        <Chip size="small" color="primary" variant="outlined" label="Confirmed · read-only" />
      )}
    </Box>
  );
}
