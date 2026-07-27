"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Fab,
  IconButton,
  Paper,
  Stack,
  TextField,
  Typography,
  alpha,
} from "@mui/material";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import SendIcon from "@mui/icons-material/Send";
import CloseIcon from "@mui/icons-material/Close";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import PlayCircleOutlineIcon from "@mui/icons-material/PlayCircleOutline";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useConfiguration } from "../../context/ConfigurationContext";
import { useOrganizationFeatures } from "../../hooks/useOrganizationFeatures";
import { useUserPermissions } from "../../hooks/useUserPermissions";
import { LEGACY_MODULES, getGuide, guideCatalog, type Guide } from "./guides";
import TourOverlay from "./TourOverlay";

// "AIMS Guide" — floating assistant bubble on the bottom-right of every portal
// page. Ask it "how do I create a delivery order?" and it answers, navigates
// you to the right screen, and runs a spotlight walkthrough (TourOverlay).
// Gated per-org by the enableGuideAssistant feature flag.

type CustomGuidePayload = {
  title: string;
  steps: Array<{ route?: string; anchor?: string; title: string; body: string; advanceOnClick?: boolean }>;
};

type Action =
  | { type: "navigate"; path: string; label?: string }
  | { type: "start_guide"; guideId: string }
  | { type: "custom_guide"; guide: CustomGuidePayload };

// A walkthrough the assistant composed on the fly (no prebuilt guide matched).
// Anchor tokens map to the same data-tour attributes the registry uses;
// editor-* anchors wait patiently since a click-through usually precedes them.
const guideFromCustom = (g: CustomGuidePayload): Guide => ({
  id: `custom:${g.title}`,
  title: g.title,
  description: "",
  route: g.steps.find((s) => s.route)?.route || "",
  steps: g.steps.map((s) => ({
    route: s.route,
    selector: s.anchor ? `[data-tour="${s.anchor}"]` : undefined,
    title: s.title,
    body: s.body,
    advanceOn: s.advanceOnClick ? ("click" as const) : undefined,
    patient: !!s.anchor && s.anchor.startsWith("editor-"),
  })),
});
type Turn = { role: "user" | "assistant"; content: string; actions?: Action[] };

const SUGGESTIONS = [
  "How do I create a delivery order?",
  "How do I add a new customer?",
  "How do I record a payment?",
  "Where are my financial reports?",
];

export default function GuideAssistant() {
  const { isGuideAssistantEnabled } = useOrganizationFeatures();
  const { getToken } = useAuth();
  const { modules } = useConfiguration();
  const { isModuleAllowed, userRoles } = useUserPermissions();
  const router = useRouter();
  const pathname = usePathname();

  // Mirror the sidebar's access rules exactly (DynamicSidebarContent): the
  // assistant must only know about screens this user can actually reach.
  const isAdminUser =
    userRoles.length === 0 ||
    userRoles.some((r: any) => ["superadmin", "admin", "osirisadmin"].includes((r?.name || "").toLowerCase()));

  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [streaming, setStreaming] = useState<Turn | null>(null);
  const [activeGuide, setActiveGuide] = useState<Guide | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length, streaming?.content, open]);

  const runAction = useCallback(
    (action: Action) => {
      if (action.type === "navigate") {
        router.push(action.path);
      } else if (action.type === "start_guide") {
        const guide = getGuide(action.guideId);
        if (guide) {
          setOpen(false); // hand the screen over to the tour
          setActiveGuide(guide);
        }
      } else if (action.type === "custom_guide") {
        setOpen(false);
        setActiveGuide(guideFromCustom(action.guide));
      }
    },
    [router],
  );

  const submit = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      if (!trimmed || loading) return;
      setLoading(true);
      const history = turns.map((t) => ({ role: t.role, content: t.content }));
      setTurns((prev) => [...prev, { role: "user", content: trimmed }]);
      setInput("");
      const acc: Turn = { role: "assistant", content: "", actions: [] };
      setStreaming({ ...acc });

      try {
        const token = await getToken();
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;
        if (typeof window !== "undefined") {
          const activeOrgId = window.sessionStorage.getItem("aims-admin-active-org");
          if (activeOrgId) headers["X-Active-Org-Id"] = activeOrgId;
        }

        const accessibleModules = (modules || [])
          .filter((m) => m.enabled)
          .filter((m) => !LEGACY_MODULES.has(m.moduleCode))
          .filter((m) => isModuleAllowed(m.moduleCode))
          .map((m) => {
            const route = m.config?.route || "/portal";
            return {
              code: m.moduleCode,
              label: m.displayName || m.moduleCode,
              route,
              subMenus: (m.config?.subMenus || [])
                // adminOnly submenus (e.g. Accounting → Posting Queue) stay
                // invisible to non-admins, matching the sidebar.
                .filter((s: any) => !(typeof s === "object" && s?.adminOnly && !isAdminUser))
                // Send each submenu's REAL path — some entries carry an href
                // override (e.g. Accounting → Setup opens /portal/settings/
                // accounting-setup), where route+key would 404.
                .map((s: any) =>
                  typeof s === "string"
                    ? { key: s, label: s, path: `${route}/${s}` }
                    : { key: s.key, label: s.label, path: s.href || `${route}/${s.key}` },
                ),
            };
          });

        const context = {
          currentPath: pathname,
          modules: accessibleModules,
          guides: guideCatalog(new Set(accessibleModules.map((m) => m.code))),
        };

        const resp = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}/guide/stream`, {
          method: "POST",
          headers,
          body: JSON.stringify({ question: trimmed, history, context }),
        });
        if (!resp.ok || !resp.body) throw new Error(`Guide assistant failed (${resp.status})`);

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() || "";
          for (const frame of frames) {
            const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
            if (!dataLine) continue;
            let evt: any;
            try {
              evt = JSON.parse(dataLine.slice(5).trim());
            } catch {
              continue;
            }
            if (evt.type === "text") {
              acc.content += evt.delta;
              setStreaming({ ...acc });
            } else if (evt.type === "action") {
              acc.actions = [...(acc.actions || []), evt.action];
              setStreaming({ ...acc });
              runAction(evt.action as Action);
            } else if (evt.type === "error") {
              throw new Error(evt.message || "Guide assistant failed");
            }
          }
        }
        setTurns((prev) => [...prev, { role: "assistant", content: acc.content || "Done — see the highlighted steps.", actions: acc.actions }]);
      } catch (e: any) {
        setTurns((prev) => [
          ...prev,
          { role: "assistant", content: acc.content || e?.message || "Sorry — something went wrong. Please try again.", actions: acc.actions },
        ]);
      } finally {
        setStreaming(null);
        setLoading(false);
      }
    },
    [loading, turns, getToken, pathname, modules, runAction, isModuleAllowed, isAdminUser],
  );

  if (!isGuideAssistantEnabled) return null;

  return (
    <>
      {activeGuide && (
        <TourOverlay
          guide={activeGuide}
          onClose={() => {
            setActiveGuide(null);
            setOpen(true); // bring the chat back so the user can ask a follow-up
          }}
        />
      )}

      {/* Chat panel */}
      {open && (
        <Paper
          elevation={8}
          sx={{
            position: "fixed",
            bottom: { xs: 84, sm: 92 },
            right: { xs: 16, sm: 24 },
            width: { xs: "calc(100vw - 32px)", sm: 384 },
            height: "min(560px, calc(100vh - 140px))",
            display: "flex",
            flexDirection: "column",
            borderRadius: 3,
            overflow: "hidden",
            zIndex: (t) => t.zIndex.modal,
            bgcolor: "background.paper",
            backgroundImage: "none",
            border: 1,
            borderColor: "divider",
          }}
        >
          {/* Header */}
          <Box
            sx={{
              px: 2,
              py: 1.25,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              borderBottom: 1,
              borderColor: "divider",
              flexShrink: 0,
            }}
          >
            <Stack direction="row" alignItems="center" gap={1}>
              <AutoAwesomeIcon sx={{ color: "primary.main", fontSize: "1.15rem" }} />
              <Typography sx={{ fontWeight: 700 }}>AIMS Guide</Typography>
            </Stack>
            <Stack direction="row" gap={0.5}>
              {turns.length > 0 && (
                <IconButton size="small" onClick={() => setTurns([])} disabled={loading} title="Clear conversation">
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              )}
              <IconButton size="small" onClick={() => setOpen(false)} title="Close">
                <CloseIcon fontSize="small" />
              </IconButton>
            </Stack>
          </Box>

          {/* Conversation */}
          <Box sx={{ flex: 1, overflowY: "auto", p: 2 }}>
            {turns.length === 0 && !streaming && (
              <Stack alignItems="center" gap={1.25} sx={{ mt: 4, px: 2, textAlign: "center" }}>
                <AutoAwesomeIcon sx={{ color: "primary.main", fontSize: "1.9rem" }} />
                <Typography variant="body2" sx={{ color: "text.secondary" }}>
                  Ask me how to do anything in AIMS — I&apos;ll take you to the right screen and walk you through it
                  step by step.
                </Typography>
                <Stack gap={0.75} sx={{ mt: 1, width: "100%" }}>
                  {SUGGESTIONS.map((s) => (
                    <Chip
                      key={s}
                      label={s}
                      size="small"
                      variant="outlined"
                      onClick={() => submit(s)}
                      sx={{
                        cursor: "pointer",
                        justifyContent: "flex-start",
                        "&:hover": { bgcolor: (t) => alpha(t.palette.primary.main, 0.08) },
                      }}
                    />
                  ))}
                </Stack>
              </Stack>
            )}
            <Stack gap={1.75}>
              {turns.map((t, i) =>
                t.role === "user" ? <UserMsg key={i} text={t.content} /> : <AssistantMsg key={i} turn={t} onAction={runAction} />,
              )}
              {streaming && <AssistantMsg turn={streaming} loading onAction={runAction} />}
              <div ref={scrollRef} />
            </Stack>
          </Box>

          {/* Input */}
          <Box sx={{ p: 1.5, borderTop: 1, borderColor: "divider", flexShrink: 0 }}>
            <Stack direction="row" alignItems="center" gap={1}>
              <TextField
                fullWidth
                size="small"
                multiline
                maxRows={3}
                placeholder="How do I…?"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit(input);
                  }
                }}
                disabled={loading}
              />
              <Button
                variant="contained"
                onClick={() => submit(input)}
                disabled={loading || !input.trim()}
                sx={{ minWidth: 42, px: 1.25 }}
              >
                {loading ? <CircularProgress size={16} color="inherit" /> : <SendIcon fontSize="small" />}
              </Button>
            </Stack>
          </Box>
        </Paper>
      )}

      {/* Floating bubble */}
      <Fab
        color="primary"
        size="medium"
        onClick={() => setOpen((v) => !v)}
        title="AIMS Guide — ask me how to do anything"
        sx={{
          position: "fixed",
          bottom: { xs: 20, sm: 28 },
          right: { xs: 16, sm: 24 },
          zIndex: (t) => t.zIndex.modal,
        }}
      >
        {open ? <CloseIcon /> : <AutoAwesomeIcon />}
      </Fab>
    </>
  );
}

function UserMsg({ text }: { text: string }) {
  return (
    <Box sx={{ alignSelf: "flex-end", maxWidth: "85%" }}>
      <Box
        sx={{
          px: 1.5,
          py: 1,
          borderRadius: 2,
          borderBottomRightRadius: 4,
          bgcolor: (t) => alpha(t.palette.primary.main, t.palette.mode === "dark" ? 0.25 : 0.1),
        }}
      >
        <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
          {text}
        </Typography>
      </Box>
    </Box>
  );
}

function AssistantMsg({ turn, loading, onAction }: { turn: Turn; loading?: boolean; onAction: (a: Action) => void }) {
  return (
    <Stack direction="row" gap={1} alignItems="flex-start" sx={{ maxWidth: "95%" }}>
      <Box
        sx={{
          width: 26,
          height: 26,
          borderRadius: "50%",
          bgcolor: (t) => alpha(t.palette.primary.main, 0.12),
          color: "primary.main",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          mt: 0.25,
        }}
      >
        <AutoAwesomeIcon sx={{ fontSize: "0.85rem" }} />
      </Box>
      <Box sx={{ minWidth: 0 }}>
        {!turn.content && loading && (
          <Stack direction="row" gap={1} alignItems="center" sx={{ mt: 0.5 }}>
            <CircularProgress size={12} />
            <Typography variant="caption" sx={{ color: "text.secondary", fontStyle: "italic" }}>
              Thinking…
            </Typography>
          </Stack>
        )}
        {turn.content && (
          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
            {turn.content}
          </Typography>
        )}
        {!!turn.actions?.length && (
          <Stack direction="row" gap={0.75} flexWrap="wrap" sx={{ mt: 0.75 }}>
            {turn.actions.map((a, i) =>
              a.type === "navigate" ? (
                <Chip
                  key={i}
                  size="small"
                  icon={<ArrowForwardIcon />}
                  label={a.label || a.path.replace("/portal/", "").replace(/-/g, " ") || "Open"}
                  onClick={() => onAction(a)}
                  sx={{ cursor: "pointer" }}
                />
              ) : (
                <Chip
                  key={i}
                  size="small"
                  color="primary"
                  variant="outlined"
                  icon={<PlayCircleOutlineIcon />}
                  label={
                    a.type === "custom_guide"
                      ? a.guide.title || "Replay walkthrough"
                      : getGuide(a.guideId)?.title || "Replay walkthrough"
                  }
                  onClick={() => onAction(a)}
                  sx={{ cursor: "pointer" }}
                />
              ),
            )}
          </Stack>
        )}
      </Box>
    </Stack>
  );
}
