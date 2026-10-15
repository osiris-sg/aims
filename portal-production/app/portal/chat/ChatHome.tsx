"use client";

// AIMEE, open: the assistant that drives AIMS, over the dashboard. Three
// columns, all full-width and full-height under the top bar: past
// conversations | the conversation | a side panel for the document or screen
// being worked on. Same brain as the WhatsApp operator
// (POST /operator/web/message). AIMEE's face in the header reacts to what is
// going on: listening while the user types, scanning while it thinks, happy
// when the reply lands.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Box, Button, Drawer, IconButton, Stack, Tooltip, Typography, useMediaQuery, useTheme } from "@mui/material";
import MenuOpenIcon from "@mui/icons-material/MenuOpen";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import GridViewOutlinedIcon from "@mui/icons-material/GridViewOutlined";
import { useNavModules } from "@/components/TopNav/useNavModules";
import { useOperatorChat, type ThreadSummary } from "./useOperatorChat";
import ThreadList from "./ThreadList";
import Messages from "./Messages";
import Composer from "./Composer";
import SidePanel from "./SidePanel";
import EmptyState from "./EmptyState";
import AimeeFace, { type AimeeMood } from "./AimeeFace";

const RAIL_KEY = "aims:chat-rail";
const PANEL_KEY = "aims:chat-panel-width";
const NAV_H = 52;

interface Props {
  /** Back to the dashboard. */
  onClose?: () => void;
  /** Sent as the first message right after opening (typed into the strip). */
  initialPrompt?: string;
}

export default function ChatHome({ onClose, initialPrompt }: Props) {
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up("md"));
  const { screens } = useNavModules();
  const chat = useOperatorChat(screens, { restorePanel: isDesktop });

  // The line typed into the strip above the dashboard goes out once.
  const sentInitial = useRef(false);
  useEffect(() => {
    if (!initialPrompt || sentInitial.current) return;
    sentInitial.current = true;
    chat.send({ text: initialPrompt });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt]);

  // Face mood: thinking beats listening beats a short happy flash after a reply.
  const [typing, setTyping] = useState(false);
  const [happyUntil, setHappyUntil] = useState(0);
  const lastCount = useRef(chat.items.length);
  useEffect(() => {
    const last = chat.items[chat.items.length - 1];
    if (chat.items.length > lastCount.current && last && last.role !== "user" && !chat.sending) {
      setHappyUntil(Date.now() + 2200);
      const t = window.setTimeout(() => setHappyUntil(0), 2200);
      lastCount.current = chat.items.length;
      return () => window.clearTimeout(t);
    }
    lastCount.current = chat.items.length;
  }, [chat.items, chat.sending]);
  const mood: AimeeMood = chat.sending ? "thinking" : chat.error ? "sad" : happyUntil > Date.now() ? "happy" : typing ? "listening" : "idle";

  const [railOpen, setRailOpen] = useState(true);
  const [railDrawer, setRailDrawer] = useState(false);
  const [panelWidth, setPanelWidth] = useState(520);
  const dragging = useRef(false);
  const shellRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      setRailOpen(window.localStorage.getItem(RAIL_KEY) !== "closed");
      const w = Number(window.localStorage.getItem(PANEL_KEY));
      if (w >= 360) setPanelWidth(w);
    } catch {
      /* no storage */
    }
  }, []);
  const toggleRail = (open: boolean) => {
    setRailOpen(open);
    try {
      window.localStorage.setItem(RAIL_KEY, open ? "open" : "closed");
    } catch {
      /* ignore */
    }
  };

  // Drag the divider to resize the side panel (desktop).
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!dragging.current || !shellRef.current) return;
      const rect = shellRef.current.getBoundingClientRect();
      const w = Math.min(Math.max(rect.right - e.clientX, 360), rect.width * 0.7);
      setPanelWidth(w);
    };
    const up = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try {
        window.localStorage.setItem(PANEL_KEY, String(Math.round(panelWidth)));
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [panelWidth]);

  const openThread = useCallback(
    (t: ThreadSummary | null) => {
      chat.openThread(t?.id ?? null, t?.channel ?? "web");
      setRailDrawer(false);
    },
    [chat],
  );

  const panelOpen = !!chat.panel;
  const empty = !chat.threadId && chat.items.length === 0 && !chat.sending;

  const rail = (
    <ThreadList
      threads={chat.threads}
      loading={chat.threadsLoading}
      error={chat.threadsError}
      onRetry={chat.reloadThreads}
      activeId={chat.threadId}
      onOpen={openThread}
      onRename={chat.renameThread}
      onDelete={chat.deleteThread}
      onCollapse={() => (isDesktop ? toggleRail(false) : setRailDrawer(false))}
    />
  );

  return (
    <Box
      ref={shellRef}
      data-tour="chat-home"
      sx={{
        display: "flex",
        width: "100%",
        height: { xs: "calc(100vh - 64px)", md: `calc(100vh - ${NAV_H}px)` },
        minHeight: 0,
        bgcolor: "background.default",
        overflow: "hidden",
      }}
    >
      {/* Chat list */}
      {isDesktop ? (
        <Box
          sx={{
            width: railOpen ? 272 : 0,
            flexShrink: 0,
            overflow: "hidden",
            transition: "width .2s",
            borderRight: railOpen ? "1px solid" : 0,
            borderColor: "divider",
            bgcolor: "var(--surface-container-low)",
            position: "relative",
          }}
        >
          <Box sx={{ width: 272, height: "100%" }}>{rail}</Box>
        </Box>
      ) : (
        <Drawer open={railDrawer} onClose={() => setRailDrawer(false)} PaperProps={{ sx: { width: 300, position: "relative" } }}>
          {rail}
        </Drawer>
      )}

      {/* Conversation */}
      <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", position: "relative" }}>
        <Stack direction="row" alignItems="center" gap={1} sx={{ px: 1.5, pt: 1, minHeight: 48 }} data-tour="aimee-header">
          {(!railOpen || !isDesktop) && (
            <Tooltip title="Show conversations">
              <IconButton size="small" onClick={() => (isDesktop ? toggleRail(true) : setRailDrawer(true))} aria-label="Show conversation list">
                <MenuOpenIcon fontSize="small" sx={{ transform: "scaleX(-1)" }} />
              </IconButton>
            </Tooltip>
          )}
          <Stack direction="row" alignItems="center" gap={1} sx={{ minWidth: 0 }}>
            <AimeeFace size={36} mood={mood} wake />
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: "0.85rem", fontWeight: 800, letterSpacing: "0.06em", lineHeight: 1.1 }}>AIMEE</Typography>
              <Typography noWrap sx={{ fontSize: "0.7rem", color: "text.secondary", lineHeight: 1.2 }}>
                {mood === "thinking" ? chat.status || "On it…" : mood === "listening" ? "Listening…" : mood === "happy" ? "Done." : mood === "sad" ? "Something went wrong." : "Ready when you are."}
              </Typography>
            </Box>
          </Stack>
          {chat.channel === "whatsapp" && chat.threadId && (
            <Stack direction="row" alignItems="center" gap={0.75} sx={{ px: 1.25, py: 0.5, borderRadius: 999, bgcolor: "action.hover", display: { xs: "none", lg: "flex" } }}>
              <WhatsAppIcon sx={{ fontSize: 16, color: "#25D366" }} />
              <Typography sx={{ fontSize: "0.75rem" }}>
                Your WhatsApp conversation, continued here. Replies are copied to your phone.
              </Typography>
            </Stack>
          )}
          <Box sx={{ flex: 1 }} />
          {onClose && (
            <Button
              size="small"
              variant="outlined"
              color="inherit"
              startIcon={<GridViewOutlinedIcon sx={{ fontSize: "1rem !important" }} />}
              onClick={onClose}
              data-tour="aimee-close"
              sx={{ textTransform: "none", borderRadius: 999, fontSize: "0.78rem", borderColor: "divider", px: 1.5 }}
            >
              Dashboard
            </Button>
          )}
        </Stack>

        <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          <Box sx={{ maxWidth: panelOpen ? 760 : 860, mx: "auto", width: "100%" }}>
            {empty ? (
              <EmptyState onPrompt={(t) => chat.send({ text: t })} onOpenScreen={(path, title) => chat.setPanel({ type: "screen", path, title })} />
            ) : chat.itemsLoading ? (
              <Typography sx={{ p: 3, color: "text.secondary", fontSize: "0.85rem" }}>Loading…</Typography>
            ) : (
              <Messages
                items={chat.items}
                pending={chat.pending}
                status={chat.status}
                sending={chat.sending}
                channel={chat.channel}
                onTap={(data) => chat.send({ callbackData: data })}
                onOpenDocument={(documentId) => chat.setPanel({ type: "document", documentId })}
              />
            )}
          </Box>
        </Box>

        {chat.error && (
          <Alert
            severity="error"
            onClose={chat.clearError}
            action={
              <Button color="inherit" size="small" onClick={chat.retry} sx={{ textTransform: "none" }}>
                Retry
              </Button>
            }
            sx={{ mx: 3, mb: 1, borderRadius: 2, maxWidth: 860, alignSelf: "center", width: "calc(100% - 48px)" }}
          >
            {chat.error}
          </Alert>
        )}
        <Box sx={{ maxWidth: panelOpen ? 760 : 860, mx: "auto", width: "100%" }}>
          {/* Keyed by thread so a draft (text or attached file) never carries into another chat. */}
          <Composer key={chat.threadId ?? "new"} sending={chat.sending} onSend={chat.send} onStop={chat.stop} onTyping={setTyping} />
        </Box>
      </Box>

      {/* Side panel */}
      {panelOpen && isDesktop && (
        <>
          <Box
            onMouseDown={(e) => {
              e.preventDefault();
              dragging.current = true;
              document.body.style.cursor = "col-resize";
              document.body.style.userSelect = "none";
            }}
            sx={{ width: 6, cursor: "col-resize", flexShrink: 0, bgcolor: "divider", "&:hover": { bgcolor: "primary.main" }, transition: "background .15s" }}
            aria-label="Resize panel"
            role="separator"
          />
          <Box sx={{ width: panelWidth, flexShrink: 0, minWidth: 0, bgcolor: "background.paper", display: "flex", flexDirection: "column" }} data-tour="chat-panel">
            <SidePanel event={chat.panel!} onClose={() => chat.setPanel(null)} />
          </Box>
        </>
      )}
      {panelOpen && !isDesktop && (
        <Drawer anchor="bottom" open onClose={() => chat.setPanel(null)} PaperProps={{ sx: { height: "92vh", borderTopLeftRadius: 16, borderTopRightRadius: 16 } }}>
          <SidePanel event={chat.panel!} onClose={() => chat.setPanel(null)} />
        </Drawer>
      )}
    </Box>
  );
}
