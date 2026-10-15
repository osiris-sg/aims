"use client";

// State + transport for the chat home. One hook owns the thread list, the open
// conversation, the streaming reply and the side-panel events, so the screen
// components stay presentational.

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { request } from "@/helpers/request";

export type ChatChannel = "web" | "whatsapp" | "telegram";

export interface ChatButton {
  label: string;
  data: string;
  description?: string;
}

export interface ChatItem {
  id: string;
  at: string;
  role: "user" | "assistant";
  kind: "text" | "document" | "buttons" | "list";
  text?: string;
  url?: string;
  filename?: string;
  documentId?: string;
  buttons?: ChatButton[];
  via: ChatChannel;
  /** Local-only: the message is being streamed / sent right now. */
  local?: boolean;
}

export interface ThreadSummary {
  id: string;
  channel: ChatChannel;
  title: string;
  number?: string;
  preview: string;
  updatedAt: string;
}

export interface PendingAction {
  id?: string;
  kind: string;
  summary: string;
  documentId?: string;
  createdAt: string;
}

export type PanelEvent =
  | { type: "document"; documentId: string; fresh?: boolean }
  | { type: "screen"; path: string; title?: string }
  | { type: "view"; title: string; stats?: Array<{ label: string; value: string }>; columns?: string[]; rows?: Array<Array<string | number | null>>; note?: string };

export interface SendInput {
  text?: string;
  callbackData?: string;
  /** One or more files (photos or PDFs) sent with the message. */
  attachments?: Array<{ dataUri: string; mimetype: string; filename?: string }>;
}

const API = process.env.NEXT_PUBLIC_BACKEND_API_URL;

// The open chat lives in the URL (?chat=<id>) so a reload, the back button or
// a pasted link lands on the same conversation.
const CHAT_PARAM = "chat";
function readChatParam(): string | null {
  try {
    return new URLSearchParams(window.location.search).get(CHAT_PARAM);
  } catch {
    return null;
  }
}
// Written through Next's router (a raw history.replaceState is overridden by
// the app router's own URL state).
function chatUrl(id: string | null): string {
  return id ? `/portal?${CHAT_PARAM}=${encodeURIComponent(id)}` : "/portal";
}

function activeOrgHeader(headers: Record<string, string>) {
  try {
    const id = window.sessionStorage.getItem("aims-admin-active-org");
    if (id) headers["X-Active-Org-Id"] = id;
  } catch {
    /* no sessionStorage */
  }
  return headers;
}

export function useOperatorChat(screens: Array<{ label: string; path: string }>, opts: { restorePanel?: boolean } = {}) {
  const { getToken } = useAuth();
  const router = useRouter();
  const writeChatParam = useCallback((id: string | null) => router.replace(chatUrl(id), { scroll: false }), [router]);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(true);
  const [threadsError, setThreadsError] = useState(false);
  const lastSend = useRef<SendInput | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [channel, setChannel] = useState<ChatChannel>("web");
  const [items, setItems] = useState<ChatItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [pending, setPending] = useState<PendingAction[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanelState] = useState<PanelEvent | null>(null);
  const setPanel = useCallback((p: PanelEvent | null) => {
    panelRef.current = p;
    setPanelState(p);
  }, []);
  const abortRef = useRef<AbortController | null>(null);
  const screensRef = useRef(screens);
  screensRef.current = screens;
  const panelRef = useRef<PanelEvent | null>(null);
  const restorePanelRef = useRef(!!opts.restorePanel);
  restorePanelRef.current = !!opts.restorePanel;
  const threadRef = useRef<string | null>(null);
  threadRef.current = threadId;

  const loadThreads = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const res = await request({ path: "/operator/web/threads", method: "GET" }, {}, token);
      if (res && res.success === false) throw new Error(res.message || "Could not load conversations");
      const list: ThreadSummary[] = res?.data?.threads || res?.threads || [];
      setThreads(list);
      setThreadsError(false);
    } catch {
      // Keep whatever was listed before; the rail shows a retry instead of
      // pretending there are no chats.
      setThreadsError(true);
    } finally {
      setThreadsLoading(false);
    }
  }, [getToken]);

  const loadThread = useCallback(
    async (id: string, quiet = false) => {
      if (!quiet) setItemsLoading(true);
      try {
        const token = await getToken();
        if (!token) return;
        const res = await request({ path: `/operator/web/threads/${encodeURIComponent(id)}`, method: "GET" }, {}, token);
        const t = res?.data ?? res;
        if (t?.error) throw new Error(t.error);
        // Never clobber a reply that is streaming in right now.
        if (threadRef.current !== id) return;
        setItems((prev) => (prev.some((i) => i.local) && quiet ? prev : t.transcript || []));
        setPending(t.pendingActions || []);
        setChannel(t.channel || "web");
        // Bring back what the panel last showed (a document, a screen).
        // Desktop only: on a phone the panel is a full-height sheet that
        // would cover the chat the user just opened.
        if (!quiet && restorePanelRef.current && t.lastPanel && t.lastPanel.type !== "view") setPanel({ ...t.lastPanel, fresh: false });
      } catch (e: any) {
        if (!quiet) setError(e?.message || "Could not open that conversation.");
      } finally {
        if (!quiet) setItemsLoading(false);
      }
    },
    [getToken],
  );

  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  // Restore the chat named in the URL on first load.
  useEffect(() => {
    const id = readChatParam();
    if (!id) return;
    threadRef.current = id;
    setThreadId(id);
    setChannel(id.startsWith("wa:") ? "whatsapp" : "web");
    loadThread(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openThread = useCallback(
    (id: string | null, ch: ChatChannel = "web") => {
      abortRef.current?.abort();
      setError(null);
      setStatus(null);
      setPanel(null);
      setPending([]);
      setThreadId(id);
      setChannel(ch);
      writeChatParam(id);
      if (id) loadThread(id);
      else setItems([]);
    },
    [loadThread, writeChatParam],
  );

  // A WhatsApp thread keeps moving on the phone: refresh it while it is open.
  useEffect(() => {
    if (!threadId || channel !== "whatsapp") return;
    const t = setInterval(() => {
      if (!sending) loadThread(threadId, true);
    }, 8000);
    return () => clearInterval(t);
  }, [threadId, channel, sending, loadThread]);

  const send = useCallback(
    async (input: SendInput) => {
      if (sending) return;
      const text = (input.text || "").trim();
      const files = input.attachments || [];
      if (!text && !input.callbackData && !files.length) return;
      lastSend.current = input;
      setSending(true);
      setError(null);
      const now = new Date().toISOString();
      const shown = input.callbackData
        ? input.callbackData.startsWith("confirm:")
          ? "Confirm"
          : input.callbackData.startsWith("cancel")
            ? "Cancel"
            : input.callbackData.startsWith("choice:")
              ? input.callbackData.slice(7)
              : ""
        : files.length
          ? `${files.map((f) => `📎 ${f.filename || "Uploaded a file"}`).join("\n")}${text ? `\n${text}` : ""}`
          : text;
      if (shown) {
        setItems((prev) => [...prev, { id: `u${Date.now()}`, at: now, role: "user", kind: "text", text: shown, via: "web", local: true }]);
      }
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const token = await getToken();
        const headers = activeOrgHeader({ "Content-Type": "application/json", Authorization: `Bearer ${token}` });
        const resp = await fetch(`${API}/operator/web/message`, {
          method: "POST",
          headers,
          signal: ctrl.signal,
          body: JSON.stringify({
            threadId: threadRef.current || undefined,
            text,
            callbackData: input.callbackData,
            attachments: files.length ? files : undefined,
            screens: screensRef.current,
            // What the user is looking at, so the agent never assumes.
            panel: panelRef.current
              ? panelRef.current.type === "document"
                ? { type: "document", documentId: panelRef.current.documentId }
                : panelRef.current.type === "screen"
                  ? { type: "screen", path: panelRef.current.path }
                  : { type: "view", title: panelRef.current.title }
              : null,
          }),
        });
        if (!resp.ok || !resp.body) throw new Error(`The assistant is unavailable (${resp.status}).`);
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let n = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() || "";
          for (const frame of frames) {
            const line = frame.split("\n").find((l) => l.startsWith("data:"));
            if (!line) continue;
            let evt: any;
            try {
              evt = JSON.parse(line.slice(5).trim());
            } catch {
              continue;
            }
            if (evt.type === "thread") {
              if (threadRef.current !== evt.id) {
                threadRef.current = evt.id;
                setThreadId(evt.id);
                writeChatParam(evt.id);
              }
            } else if (evt.type === "message") {
              setStatus(null);
              setItems((prev) => [
                ...prev,
                { id: `a${Date.now()}${n++}`, at: new Date().toISOString(), role: "assistant", kind: evt.kind, text: evt.text, url: evt.url, filename: evt.filename, buttons: evt.buttons, via: "web", local: true },
              ]);
            } else if (evt.type === "status") {
              setStatus(evt.text || null);
            } else if (evt.type === "ui") {
              setPanel(evt.event);
            } else if (evt.type === "title") {
              // The chat got its real name after the first exchange.
              setThreads((prev) => prev.map((t) => (t.id === evt.id ? { ...t, title: evt.title } : t)));
            } else if (evt.type === "pending") {
              setPending(evt.actions || []);
            } else if (evt.type === "error") {
              setError(evt.message || "Something went wrong.");
            }
          }
        }
      } catch (e: any) {
        if (e?.name === "AbortError") {
          /* stopped by the user */
        } else if (e instanceof TypeError || /failed to fetch|network/i.test(String(e?.message))) {
          setError("Could not reach AIMS. Check your connection and try again.");
        } else {
          setError(e?.message || "Something went wrong.");
        }
      } finally {
        setStatus(null);
        setSending(false);
        // Drop the local flags; the server copy is now the record.
        setItems((prev) => prev.map((i) => ({ ...i, local: false })));
        loadThreads();
      }
    },
    [sending, getToken, loadThreads, writeChatParam],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const renameThread = useCallback(
    async (id: string, title: string) => {
      const token = await getToken();
      if (!token) return;
      await request({ path: `/operator/web/threads/${encodeURIComponent(id)}`, method: "PATCH" }, { title }, token);
      loadThreads();
    },
    [getToken, loadThreads],
  );

  const deleteThread = useCallback(
    async (id: string) => {
      const token = await getToken();
      if (!token) return;
      await request({ path: `/operator/web/threads/${encodeURIComponent(id)}`, method: "DELETE" }, {}, token);
      if (threadRef.current === id) openThread(null);
      loadThreads();
    },
    [getToken, loadThreads, openThread],
  );

  return {
    threads,
    threadsLoading,
    threadsError,
    reloadThreads: loadThreads,
    retry: () => {
      const last = lastSend.current;
      if (!last) return;
      // Drop the unsent local bubble so the retry does not show it twice.
      setItems((prev) => prev.filter((i) => !(i.local && i.role === "user")));
      setError(null);
      void send(last);
    },
    threadId,
    channel,
    items,
    itemsLoading,
    pending,
    status,
    sending,
    error,
    panel,
    setPanel,
    clearError: () => setError(null),
    openThread,
    send,
    stop,
    renameThread,
    deleteThread,
    reload: () => threadId && loadThread(threadId, true),
  };
}
