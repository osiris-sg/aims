"use client";

// Round BL — the AIMEE side panel for a shipments org (ADH first): AIMEE next to the work, so a user can ask while going
// through an order. Same brain and conversations as AIMEE on the dashboard (POST /operator/web/message, the shipments
// tool set, the user's own permissions); only the frame is new.
//   - Opens from the "AIMEE" button in the order header, the top-bar AIMEE face, "Ask AIMEE" on an email card and in
//     the Answer flow. Docks on the right under the top bar, resizable (drag its left edge), folds to a slim tab on the
//     right edge; the page content moves left so it stays usable. Open / closed and the width are remembered per user
//     (in this browser). Phone: a full-screen sheet.
//   - Knows what is in view (bridge.ts page context: the order / shipment, the open step, the email, the language) and
//     shows it in the header ("#18-1 · Step 7"); one conversation per order / email (history kept), "New chat" starts
//     another. Suggested questions are static (no tokens until one is pressed).
//   - Answers cite the record with links; a /portal link opens in place (the page moves, the panel stays). Changes
//     come back as Confirm / Cancel cards in the panel (nothing changes without OK).

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import { Alert, Box, Button, Chip, Drawer, GlobalStyles, IconButton, Stack, Tooltip, Typography, useMediaQuery, useTheme } from "@mui/material";
import AddCommentOutlinedIcon from "@mui/icons-material/AddCommentOutlined";
import OpenInFullIcon from "@mui/icons-material/OpenInFull";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import CloseIcon from "@mui/icons-material/Close";
import AimeeFace from "@/app/portal/chat/AimeeFace";
import Messages from "@/app/portal/chat/Messages";
import Composer from "@/app/portal/chat/Composer";
import type { ChatItem, PendingAction, SendInput, ThreadSummary } from "@/app/portal/chat/useOperatorChat";
import { DOCK_EVENT, GUIDE_EVENT, scopeOf, setDockMounted, useAimeeContext, type DockCommand } from "./bridge";
import { contextLabel, suggestionKeys } from "./suggestions";

const NAV_H = 52;
const MIN_W = 320;
const MAX_W = 760;
const DEFAULT_W = 400;
const TAB_W = 30;

/** What the panel needs from a conversation engine: useOperatorChat live, a fixture in /preview. */
export interface DockChat {
  threads: ThreadSummary[];
  threadsLoading: boolean;
  threadId: string | null;
  items: ChatItem[];
  itemsLoading: boolean;
  pending: PendingAction[];
  status: string | null;
  sending: boolean;
  error: string | null;
  send: (input: SendInput) => void;
  stop: () => void;
  openThread: (id: string | null) => void;
  retry: () => void;
  clearError: () => void;
  reloadThreads: () => void;
}

const storeKey = (userId: string | null | undefined, k: string) => `aims:aimee-dock:${k}:${userId ?? "anon"}`;
const read = (key: string) => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, v: string) => {
  try {
    window.localStorage.setItem(key, v);
  } catch {
    /* private mode: not remembered */
  }
};

/**
 * `quiet` (every AIMEE org without SHIPMENTS, guru 2026-11-09): the panel exists only while something opened it — an
 * "Ask AIMEE" button on the page — so there is no folded tab on the edge and the top-bar face keeps opening full
 * AIMEE (the panel does not announce itself through setDockMounted).
 */
export default function AimeeDock({ chat, initialOpen, quiet }: { chat: DockChat; initialOpen?: boolean; quiet?: boolean }) {
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up("md"));
  const router = useRouter();
  const { userId } = useAuth();
  const t = useTranslations("aimee.dock");
  const ts = useTranslations("aimee.suggest");
  const ctx = useAimeeContext();
  const scope = scopeOf(ctx);

  // ── open / closed + width, per user ────────────────────────────────────────
  const [open, setOpenState] = useState(!!initialOpen);
  const [width, setWidth] = useState(DEFAULT_W);
  const [aboveModal, setAboveModal] = useState(false);
  const [queued, setQueued] = useState<string | null>(null);
  useEffect(() => {
    if (initialOpen) return;
    setOpenState(read(storeKey(userId, "open")) === "1");
    const w = Number(read(storeKey(userId, "width")));
    if (w >= MIN_W && w <= MAX_W) setWidth(w);
  }, [userId, initialOpen]);
  const setOpen = useCallback(
    (v: boolean) => {
      setOpenState(v);
      if (!v) setAboveModal(false);
      write(storeKey(userId, "open"), v ? "1" : "0");
    },
    [userId],
  );

  useEffect(() => {
    if (!quiet) setDockMounted(true);
    const onCmd = (e: Event) => {
      const d = (e as CustomEvent<DockCommand>).detail;
      if (!d) return;
      if (d.action === "close") return setOpen(false);
      if (d.action === "toggle") return setOpenState((o) => {
        write(storeKey(userId, "open"), o ? "0" : "1");
        return !o;
      });
      setAboveModal(!!d.aboveModal);
      setOpen(true);
      if (d.prompt) setQueued(d.prompt);
    };
    // A walkthrough needs the screen: fold to the tab while it runs.
    const onGuide = () => setOpen(false);
    window.addEventListener(DOCK_EVENT, onCmd);
    window.addEventListener(GUIDE_EVENT, onGuide);
    return () => {
      if (!quiet) setDockMounted(false);
      window.removeEventListener(DOCK_EVENT, onCmd);
      window.removeEventListener(GUIDE_EVENT, onGuide);
    };
  }, [setOpen, userId]);

  // ── one conversation per order / email ─────────────────────────────────────
  // The newest conversation of this scope opens when the scope changes; "New chat" starts an empty one (it becomes
  // the newest of the scope with its first message).
  const picked = useRef<string | null>(null);
  useEffect(() => {
    if (chat.threadsLoading) return;
    if (picked.current === scope) return;
    picked.current = scope;
    const hit = chat.threads.find((x) => x.channel === "web" && x.scope === scope);
    if ((hit?.id ?? null) !== chat.threadId) chat.openThread(hit?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, chat.threadsLoading, chat.threads]);
  const newChat = () => chat.openThread(null);

  // A prompt sent from a button ("Ask AIMEE" on a card) goes out once the panel is on the right conversation.
  useEffect(() => {
    if (!queued || !open || chat.sending || chat.threadsLoading || picked.current !== scope) return;
    chat.send({ text: queued });
    setQueued(null);
  }, [queued, open, chat, scope]);

  // ── resize ─────────────────────────────────────────────────────────────────
  const dragging = useRef(false);
  const [resizing, setResizing] = useState(false);
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!dragging.current) return;
      setWidth(Math.min(MAX_W, Math.max(MIN_W, window.innerWidth - e.clientX)));
    };
    const up = () => {
      if (!dragging.current) return;
      dragging.current = false;
      setResizing(false);
      setWidth((w) => {
        write(storeKey(userId, "width"), String(w));
        return w;
      });
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [userId]);

  // A /portal link in an answer opens in place; the panel stays.
  const onClickCapture = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement | null)?.closest?.("a") as HTMLAnchorElement | null;
    const href = a?.getAttribute("href") ?? "";
    if (href.startsWith("/portal")) {
      e.preventDefault();
      e.stopPropagation();
      router.push(href);
    }
  };

  const label = contextLabel(ctx, (k, v) => t(k as any, v as any));
  const keys = useMemo(() => (quiet ? ["gen_1", "gen_2", "gen_3"] : suggestionKeys(ctx)), [ctx, quiet]);
  const ask = (key: string) => chat.send({ text: key === "showHow" ? ts("showHowPrompt") : ts(key as any) });
  const empty = !chat.items.length && !chat.itemsLoading;
  // The Confirm card's words come from the operator in English: shown in the user's language here.
  const items = useMemo(
    () =>
      chat.items.map((i) =>
        i.buttons?.some((b) => b.data.startsWith("confirm:"))
          ? { ...i, text: (i.text ?? "").replace(/\n\nConfirm\?$/, `\n\n${t("confirmQ")}`), buttons: i.buttons.map((b) => (b.data.startsWith("confirm:") ? { ...b, label: t("confirm") } : b.data.startsWith("cancel") ? { ...b, label: t("cancel") } : b)) }
          : i,
      ),
    [chat.items, t],
  );

  const panel = (
    <Box
      data-tour="aimee-dock"
      onClickCapture={onClickCapture}
      sx={{ height: "100%", display: "flex", flexDirection: "column", bgcolor: "background.paper", minWidth: 0 }}
    >
      {/* Header: AIMEE + what is in view */}
      <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1.5, py: 1, borderBottom: 1, borderColor: "divider", minHeight: 52 }}>
        <AimeeFace size={28} mood={chat.sending ? "thinking" : chat.error ? "sad" : "idle"} track={false} />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography sx={{ fontSize: "0.7rem", fontWeight: 800, letterSpacing: "0.12em", color: "text.secondary", lineHeight: 1.2 }}>{t("title")}</Typography>
          {/* No shipment context on a quiet panel: the chip would only say "Shipments". */}
          {!quiet && <Chip size="small" label={label} data-tour="aimee-dock-context" sx={{ mt: 0.25, maxWidth: "100%", height: 22, fontWeight: 600, "& .MuiChip-label": { px: 1 } }} />}
        </Box>
        <Tooltip title={t("newChat")}>
          <IconButton size="small" aria-label={t("newChat")} onClick={newChat} data-tour="aimee-dock-new">
            <AddCommentOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        {isDesktop && chat.threadId && (
          <Tooltip title={t("openFull")}>
            <IconButton size="small" aria-label={t("openFull")} onClick={() => router.push(`/portal?chat=${encodeURIComponent(chat.threadId!)}`)}>
              <OpenInFullIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title={isDesktop ? t("collapse") : t("close")}>
          <IconButton size="small" aria-label={isDesktop ? t("collapse") : t("close")} onClick={() => setOpen(false)} data-tour="aimee-dock-collapse">
            {isDesktop ? <ChevronRightIcon fontSize="small" /> : <CloseIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      </Stack>

      {/* The conversation */}
      <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", "& > div": { px: 1.5 } }}>
        {chat.itemsLoading ? (
          <Typography sx={{ p: 2, color: "text.secondary", fontSize: "0.85rem" }}>{t("loading")}</Typography>
        ) : empty ? (
          <Box sx={{ p: 2 }}>
            <Typography sx={{ color: "text.secondary", fontSize: "0.85rem" }}>{t("intro")}</Typography>
          </Box>
        ) : (
          <Messages items={items} pending={chat.pending} status={chat.status} sending={chat.sending} channel="web" onTap={(data) => chat.send({ callbackData: data })} onOpenDocument={() => undefined} />
        )}
      </Box>

      {chat.error && (
        <Alert
          severity="error"
          sx={{ mx: 1.5, mb: 1 }}
          action={
            <Button color="inherit" size="small" onClick={chat.retry}>
              {t("retry")}
            </Button>
          }
          onClose={chat.clearError}
        >
          {chat.error || t("error")}
        </Alert>
      )}

      {/* Suggested questions (static: nothing is sent until one is pressed) */}
      {!chat.sending && (
        <Box sx={{ px: 1.5, pt: 0.75 }} data-tour="aimee-dock-suggestions">
          {empty && <Typography sx={{ fontSize: "0.7rem", fontWeight: 700, color: "text.secondary", mb: 0.5 }}>{t("suggested")}</Typography>}
          <Stack direction="row" gap={0.75} flexWrap="wrap">
            {(empty ? keys : keys.slice(0, 3)).map((k) => (
              <Chip key={k} size="small" variant="outlined" clickable label={ts(k as any)} onClick={() => ask(k)} sx={{ maxWidth: "100%", height: "auto", py: 0.25, "& .MuiChip-label": { whiteSpace: "normal" } }} />
            ))}
          </Stack>
        </Box>
      )}

      <Box sx={{ p: 1.5, pt: 1 }}>
        <Composer key={chat.threadId ?? `new:${scope}`} sending={chat.sending} placeholder={ctx?.ref || ctx?.email ? t("placeholder") : t("placeholderGeneral")} onSend={chat.send} onStop={chat.stop} />
      </Box>
    </Box>
  );

  // ── phone: a full-screen sheet ─────────────────────────────────────────────
  if (!isDesktop) {
    return (
      <>
        {!open && (
          <Tooltip title={t("open")}>
            <IconButton
              aria-label={t("open")}
              onClick={() => setOpen(true)}
              data-tour="aimee-dock-tab"
              sx={{ position: "fixed", right: 16, bottom: 16, zIndex: (th) => th.zIndex.speedDial, bgcolor: "background.paper", boxShadow: 3, p: 0.75, "&:hover": { bgcolor: "background.paper" } }}
            >
              <AimeeFace size={36} track={false} />
            </IconButton>
          </Tooltip>
        )}
        <Drawer anchor="right" open={open} onClose={() => setOpen(false)} PaperProps={{ sx: { width: "100%", maxWidth: "100%" } }} sx={{ zIndex: (th) => th.zIndex.modal + 2 }}>
          {panel}
        </Drawer>
      </>
    );
  }

  // ── desktop: docked on the right ───────────────────────────────────────────
  const z = aboveModal ? theme.zIndex.modal + 2 : theme.zIndex.appBar - 1;
  return (
    <>
      {/* The page moves left so it stays usable (the root layout resets body padding with .ROOT_LAYOUT, so the selector outranks a class). */}
      {open && !aboveModal && <GlobalStyles styles={{ "html body, html body[class]": { paddingRight: `${width}px` } }} />}
      {!open && !quiet && (
        <Tooltip title={t("open")} placement="left">
          <Box
            component="button"
            type="button"
            aria-label={t("open")}
            onClick={() => setOpen(true)}
            data-tour="aimee-dock-tab"
            sx={{
              position: "fixed",
              right: 0,
              top: "50%",
              transform: "translateY(-50%)",
              zIndex: z,
              width: TAB_W,
              py: 1.25,
              border: 1,
              borderRight: 0,
              borderColor: "divider",
              borderRadius: "10px 0 0 10px",
              bgcolor: "background.paper",
              color: "text.primary",
              boxShadow: 2,
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 0.75,
              "&:hover": { bgcolor: "action.hover" },
            }}
          >
            <AimeeFace size={22} track={false} />
            <Typography component="span" sx={{ writingMode: "vertical-rl", fontSize: "0.7rem", fontWeight: 800, letterSpacing: "0.14em" }}>
              {t("tab")}
            </Typography>
          </Box>
        </Tooltip>
      )}
      {open && (
        <Box
          sx={{
            position: "fixed",
            top: NAV_H,
            right: 0,
            bottom: 0,
            width,
            zIndex: z,
            borderLeft: 1,
            borderColor: "divider",
            boxShadow: aboveModal ? 8 : 3,
            display: "flex",
          }}
        >
          <Box
            role="separator"
            aria-label={t("resize")}
            title={t("resize")}
            onMouseDown={(e) => {
              e.preventDefault();
              dragging.current = true;
              setResizing(true);
            }}
            sx={{ width: 6, cursor: "col-resize", flexShrink: 0, bgcolor: resizing ? "primary.main" : "transparent", "&:hover": { bgcolor: "action.hover" } }}
          />
          <Box sx={{ flex: 1, minWidth: 0, pointerEvents: resizing ? "none" : "auto" }}>{panel}</Box>
        </Box>
      )}
    </>
  );
}
