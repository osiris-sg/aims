"use client";

import React, { useState } from "react";
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, InputBase, List, ListItemButton, Menu, MenuItem, Skeleton, Stack, Tooltip, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import MoreHorizIcon from "@mui/icons-material/MoreHoriz";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import type { ThreadSummary } from "./useOperatorChat";

interface Props {
  threads: ThreadSummary[];
  loading: boolean;
  error?: boolean;
  onRetry?: () => void;
  activeId: string | null;
  onOpen: (t: ThreadSummary | null) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onCollapse: () => void;
}

const dayLabel = (iso: string) => {
  const d = new Date(iso);
  const now = new Date();
  const diff = (now.setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86400000;
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return "This week";
  return "Older";
};

export default function ThreadList({ threads, loading, error, onRetry, activeId, onOpen, onRename, onDelete, onCollapse }: Props) {
  const [menu, setMenu] = useState<{ pos: { left: number; top: number }; t: ThreadSummary } | null>(null);
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ThreadSummary | null>(null);

  const wa = threads.filter((t) => t.channel === "whatsapp");
  const web = threads.filter((t) => t.channel !== "whatsapp");
  const groups: Array<{ label: string; items: ThreadSummary[] }> = [];
  for (const t of web) {
    const label = dayLabel(t.updatedAt);
    const g = groups.find((x) => x.label === label);
    if (g) g.items.push(t);
    else groups.push({ label, items: [t] });
  }

  const row = (t: ThreadSummary) => {
    const active = t.id === activeId;
    const isWa = t.channel === "whatsapp";
    return (
      <ListItemButton
        key={t.id}
        selected={active}
        onClick={() => onOpen(t)}
        sx={{
          borderRadius: 2,
          py: 0.75,
          px: 1.25,
          mb: 0.25,
          alignItems: "flex-start",
          gap: 1,
          "&.Mui-selected": { bgcolor: "action.selected" },
          "& .thread-more": { opacity: 0 },
          "&:hover .thread-more, &.Mui-selected .thread-more": { opacity: 1 },
        }}
      >
        {isWa && <WhatsAppIcon sx={{ fontSize: 18, mt: 0.25, color: "#25D366" }} />}
        <Box sx={{ minWidth: 0, flex: 1 }}>
          {editing?.id === t.id ? (
            <InputBase
              autoFocus
              value={editing.title}
              onChange={(e) => setEditing({ id: t.id, title: e.target.value })}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onRename(t.id, editing.title.trim() || t.title);
                  setEditing(null);
                }
                if (e.key === "Escape") setEditing(null);
              }}
              onBlur={() => {
                if (editing.title.trim() && editing.title !== t.title) onRename(t.id, editing.title.trim());
                setEditing(null);
              }}
              sx={{ fontSize: "0.85rem", width: "100%", px: 0.5, border: "1px solid", borderColor: "primary.main", borderRadius: 1 }}
            />
          ) : (
            <Typography noWrap sx={{ fontSize: "0.85rem", fontWeight: active ? 600 : 500 }}>
              {isWa ? "WhatsApp" : t.title}
            </Typography>
          )}
          <Typography noWrap sx={{ fontSize: "0.72rem", color: "text.secondary" }}>
            {isWa ? `Continue your chat with the AIMS line${t.number ? ` (+${t.number})` : ""}` : t.preview || "Empty chat"}
          </Typography>
        </Box>
        {!isWa && (
          <IconButton
            className="thread-more"
            size="small"
            aria-label="Chat options"
            onClick={(e) => {
              e.stopPropagation();
              setMenu({ pos: { left: e.clientX, top: e.clientY }, t });
            }}
            sx={{ mt: -0.25 }}
          >
            <MoreHorizIcon fontSize="small" />
          </IconButton>
        )}
      </ListItemButton>
    );
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minWidth: 0 }}>
      <Stack direction="row" alignItems="center" gap={1} sx={{ p: 1.5, pb: 1 }}>
        <Button
          fullWidth
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => onOpen(null)}
          data-tour="chat-new"
          sx={{ textTransform: "none", borderRadius: 2.5, boxShadow: "none" }}
        >
          New chat
        </Button>
        <Tooltip title="Hide chats">
          <IconButton size="small" onClick={onCollapse} aria-label="Hide chat list">
            <ChevronLeftIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
      <Box sx={{ flex: 1, overflowY: "auto", px: 1, pb: 1 }}>
        {loading ? (
          <Stack gap={1} sx={{ px: 1, pt: 1 }}>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} variant="rounded" height={44} />
            ))}
          </Stack>
        ) : (
          <>
            {wa.length > 0 && (
              <List dense disablePadding sx={{ mb: 1 }}>
                {wa.map(row)}
              </List>
            )}
            {groups.map((g) => (
              <Box key={g.label} sx={{ mb: 1 }}>
                <Typography sx={{ px: 1.25, py: 0.5, fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "text.secondary" }}>
                  {g.label}
                </Typography>
                <List dense disablePadding>
                  {g.items.map(row)}
                </List>
              </Box>
            ))}
            {!wa.length && !web.length && (
              <Typography sx={{ px: 1.5, py: 2, fontSize: "0.8rem", color: "text.secondary" }}>
                {error ? (
                  <>
                    Couldn&apos;t load your chats.{" "}
                    <Box component="button" onClick={onRetry} sx={{ background: "none", border: 0, p: 0, color: "primary.main", cursor: "pointer", font: "inherit" }}>
                      Retry
                    </Box>
                  </>
                ) : (
                  "No chats yet. Your conversations will appear here."
                )}
              </Typography>
            )}
          </>
        )}
      </Box>

      <Menu
        open={!!menu}
        onClose={() => setMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={menu?.pos}
      >
        <MenuItem
          onClick={() => {
            if (menu) setEditing({ id: menu.t.id, title: menu.t.title });
            setMenu(null);
          }}
        >
          Rename
        </MenuItem>
        <MenuItem
          sx={{ color: "error.main" }}
          onClick={() => {
            if (menu) setConfirmDelete(menu.t);
            setMenu(null);
          }}
        >
          Delete
        </MenuItem>
      </Menu>

      <Dialog open={!!confirmDelete} onClose={() => setConfirmDelete(null)} PaperProps={{ sx: { borderRadius: 3, maxWidth: 360 } }}>
        <DialogTitle sx={{ fontWeight: 700, pb: 0.5 }}>Delete this chat?</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: "0.875rem", color: "text.secondary" }}>
            “{confirmDelete?.title}” will be removed. Documents it created are not affected.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button size="small" onClick={() => setConfirmDelete(null)} sx={{ textTransform: "none" }}>Keep</Button>
          <Button
            size="small"
            color="error"
            variant="contained"
            onClick={() => {
              if (confirmDelete) onDelete(confirmDelete.id);
              setConfirmDelete(null);
            }}
            sx={{ textTransform: "none", backgroundImage: "none" }}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
