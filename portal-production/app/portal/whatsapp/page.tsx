"use client";

// WhatsApp module — connect the org's WhatsApp Business number via Meta's
// Embedded Signup (we are the Tech Provider app), then send template/text
// messages and see the inbound/outbound log.
//
// Flow: FB.login popup (config below) → client creates/selects their WABA and
// verifies their number on Meta's side → the popup posts a WA_EMBEDDED_SIGNUP
// message with waba_id/phone_number_id and the login callback returns a
// one-time code → POST /whatsapp/onboard does the server-side token exchange.

import { useAuth } from "@clerk/nextjs";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
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
import { WhatsApp as WhatsAppIcon, Refresh, LinkOff, Send } from "@mui/icons-material";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-toastify";

const apiBase = process.env.NEXT_PUBLIC_BACKEND_API_URL;
const META_APP_ID = process.env.NEXT_PUBLIC_META_APP_ID ?? "1735244581178849";
const ES_CONFIG_ID = process.env.NEXT_PUBLIC_META_ES_CONFIG_ID ?? "1347041930121140";
const GRAPH_VERSION = "v23.0";

declare global {
  interface Window {
    FB?: any;
    fbAsyncInit?: () => void;
  }
}

interface ConnectionStatus {
  status: string;
  wabaId?: string;
  phoneNumberId?: string;
  displayPhoneNumber?: string | null;
  verifiedName?: string | null;
  lastError?: string | null;
  connectedAt?: string;
}

interface MessageRow {
  id: string;
  direction: "OUTBOUND" | "INBOUND";
  counterparty: string;
  templateName?: string | null;
  body?: string | null;
  status: string;
  error?: string | null;
  createdAt: string;
}

function useWhatsAppApi() {
  const { getToken } = useAuth();
  const request = useCallback(
    async <T = any,>(path: string, init?: RequestInit): Promise<T> => {
      const token = await getToken();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(init?.headers as Record<string, string> | undefined),
        Authorization: `Bearer ${token}`,
      };
      if (typeof window !== "undefined") {
        const activeOrgId = window.sessionStorage.getItem("aims-admin-active-org");
        if (activeOrgId) headers["X-Active-Org-Id"] = activeOrgId;
      }
      const res = await fetch(`${apiBase}${path}`, { ...init, headers });
      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = text;
      }
      if (!res.ok) {
        const msg = json?.message || (typeof json === "string" ? json : `Request failed (${res.status})`);
        throw new Error(msg);
      }
      return (json?.data ?? json) as T;
    },
    [getToken],
  );
  return useMemo(() => ({ request }), [request]);
}

const statusChipColor = (status: string): "success" | "default" | "error" | "info" | "warning" => {
  switch (status) {
    case "CONNECTED":
    case "delivered":
    case "read":
      return "success";
    case "sent":
    case "received":
      return "info";
    case "failed":
    case "ERROR":
      return "error";
    case "DISCONNECTED":
      return "warning";
    default:
      return "default";
  }
};

export default function WhatsAppPage() {
  const { request } = useWhatsAppApi();

  const [connection, setConnection] = useState<ConnectionStatus | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);

  // Test-send form
  const [sendTo, setSendTo] = useState("");
  const [templateName, setTemplateName] = useState("hello_world");
  const [languageCode, setLanguageCode] = useState("en_US");
  const [freeText, setFreeText] = useState("");
  const [sending, setSending] = useState(false);

  // waba_id / phone_number_id arrive via postMessage BEFORE the FB.login
  // callback resolves with the code — stash them on a ref.
  const sessionInfoRef = useRef<{ wabaId?: string; phoneNumberId?: string }>({});

  const loadAll = useCallback(async () => {
    try {
      const [status, log] = await Promise.all([
        request<ConnectionStatus>("/whatsapp/status"),
        request<MessageRow[]>("/whatsapp/messages?limit=50"),
      ]);
      setConnection(status);
      setMessages(Array.isArray(log) ? log : []);
    } catch (e: any) {
      toast.error(e.message || "Failed to load WhatsApp status");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Load the Facebook JS SDK once.
  useEffect(() => {
    if (window.FB) {
      setSdkReady(true);
      return;
    }
    window.fbAsyncInit = () => {
      window.FB.init({ appId: META_APP_ID, autoLogAppEvents: true, xfbml: false, version: GRAPH_VERSION });
      setSdkReady(true);
    };
    const script = document.createElement("script");
    script.src = "https://connect.facebook.net/en_US/sdk.js";
    script.async = true;
    script.defer = true;
    script.crossOrigin = "anonymous";
    document.body.appendChild(script);
  }, []);

  // Embedded Signup session info (waba_id, phone_number_id) via postMessage.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!event.origin.endsWith("facebook.com")) return;
      try {
        const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (data?.type !== "WA_EMBEDDED_SIGNUP") return;
        if (data.event === "FINISH" || data.event === "FINISH_ONLY_WABA") {
          sessionInfoRef.current = {
            wabaId: data.data?.waba_id,
            phoneNumberId: data.data?.phone_number_id,
          };
        } else if (data.event === "CANCEL") {
          setConnecting(false);
        }
      } catch {
        // Non-JSON frame chatter — ignore.
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const completeOnboard = useCallback(
    async (code: string) => {
      const { wabaId, phoneNumberId } = sessionInfoRef.current;
      if (!wabaId || !phoneNumberId) {
        toast.error("Signup finished but WABA details were not received — please try again.");
        setConnecting(false);
        return;
      }
      try {
        await request("/whatsapp/onboard", {
          method: "POST",
          body: JSON.stringify({ code, wabaId, phoneNumberId }),
        });
        toast.success("WhatsApp connected!");
        await loadAll();
      } catch (e: any) {
        toast.error(e.message || "Onboarding failed");
      } finally {
        setConnecting(false);
      }
    },
    [request, loadAll],
  );

  const launchSignup = useCallback(() => {
    if (!window.FB) {
      toast.error("Facebook SDK not loaded yet — try again in a moment.");
      return;
    }
    setConnecting(true);
    sessionInfoRef.current = {};
    window.FB.login(
      (response: any) => {
        const code = response?.authResponse?.code;
        if (code) {
          completeOnboard(code);
        } else {
          setConnecting(false);
        }
      },
      {
        config_id: ES_CONFIG_ID,
        response_type: "code",
        override_default_response_type: true,
        extras: { setup: {}, featureType: "", sessionInfoVersion: "3" },
      },
    );
  }, [completeOnboard]);

  const handleDisconnect = useCallback(async () => {
    setDisconnectOpen(false);
    try {
      await request("/whatsapp/disconnect", { method: "POST" });
      toast.success("WhatsApp disconnected");
      await loadAll();
    } catch (e: any) {
      toast.error(e.message || "Disconnect failed");
    }
  }, [request, loadAll]);

  const handleSend = useCallback(
    async (mode: "template" | "text") => {
      if (!sendTo.trim()) {
        toast.error("Enter a recipient number (with country code, e.g. 6591234567)");
        return;
      }
      setSending(true);
      try {
        if (mode === "template") {
          await request("/whatsapp/send-template", {
            method: "POST",
            body: JSON.stringify({ to: sendTo, templateName, languageCode }),
          });
        } else {
          if (!freeText.trim()) {
            toast.error("Enter a message");
            setSending(false);
            return;
          }
          await request("/whatsapp/send-text", {
            method: "POST",
            body: JSON.stringify({ to: sendTo, body: freeText }),
          });
        }
        toast.success("Message sent");
        setFreeText("");
        await loadAll();
      } catch (e: any) {
        toast.error(e.message || "Send failed");
      } finally {
        setSending(false);
      }
    },
    [request, sendTo, templateName, languageCode, freeText, loadAll],
  );

  const isConnected = connection?.status === "CONNECTED";

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 10 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3, maxWidth: 1100, mx: "auto" }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 3 }}>
        <WhatsAppIcon color="success" fontSize="large" />
        <Box>
          <Typography variant="h5" fontWeight={700}>
            WhatsApp
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Connect this organization&apos;s WhatsApp Business number and send alerts via the Cloud API.
          </Typography>
        </Box>
      </Stack>

      {/* Connection card */}
      <Paper variant="outlined" sx={{ p: 3, mb: 3 }}>
        {isConnected ? (
          <Stack spacing={1.5}>
            <Stack direction="row" alignItems="center" spacing={1.5} flexWrap="wrap" useFlexGap>
              <Chip label="Connected" color="success" size="small" />
              <Typography variant="h6">{connection?.displayPhoneNumber || connection?.phoneNumberId}</Typography>
              {connection?.verifiedName && (
                <Typography variant="body2" color="text.secondary">
                  {connection.verifiedName}
                </Typography>
              )}
            </Stack>
            <Typography variant="body2" color="text.secondary">
              WABA ID: {connection?.wabaId} · Phone Number ID: {connection?.phoneNumberId}
            </Typography>
            {connection?.lastError && <Alert severity="warning">{connection.lastError}</Alert>}
            <Box>
              <Button
                startIcon={<LinkOff />}
                color="warning"
                variant="outlined"
                size="small"
                onClick={() => setDisconnectOpen(true)}
              >
                Disconnect
              </Button>
            </Box>
          </Stack>
        ) : (
          <Stack spacing={2} alignItems="flex-start">
            {connection?.status === "DISCONNECTED" && (
              <Alert severity="warning" sx={{ width: "100%" }}>
                This organization&apos;s WhatsApp connection is disconnected. Reconnect to resume sending.
              </Alert>
            )}
            <Typography variant="body1">
              No WhatsApp number is connected yet. Click below to launch Meta&apos;s Embedded Signup — you&apos;ll log
              in with Facebook, pick or create a WhatsApp Business Account, and verify the phone number to use.
            </Typography>
            <Button
              variant="contained"
              color="success"
              size="large"
              startIcon={connecting ? <CircularProgress size={18} color="inherit" /> : <WhatsAppIcon />}
              disabled={!sdkReady || connecting}
              onClick={launchSignup}
            >
              {connecting ? "Waiting for signup…" : "Connect WhatsApp"}
            </Button>
            {!sdkReady && (
              <Typography variant="caption" color="text.secondary">
                Loading Facebook SDK…
              </Typography>
            )}
          </Stack>
        )}
      </Paper>

      {/* Send panel */}
      {isConnected && (
        <Paper variant="outlined" sx={{ p: 3, mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>
            Send a message
          </Typography>
          <Stack spacing={2}>
            <TextField
              label="Recipient (with country code)"
              placeholder="6591234567"
              value={sendTo}
              onChange={(e) => setSendTo(e.target.value)}
              size="small"
              sx={{ maxWidth: 320 }}
            />
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ sm: "center" }}>
              <TextField
                label="Template name"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                size="small"
                sx={{ maxWidth: 240 }}
              />
              <TextField
                label="Language"
                value={languageCode}
                onChange={(e) => setLanguageCode(e.target.value)}
                size="small"
                sx={{ maxWidth: 140 }}
              />
              <Button
                variant="contained"
                startIcon={<Send />}
                disabled={sending}
                onClick={() => handleSend("template")}
              >
                Send template
              </Button>
            </Stack>
            <Divider flexItem>
              <Typography variant="caption" color="text.secondary">
                or free text (24h reply window only)
              </Typography>
            </Divider>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ sm: "center" }}>
              <TextField
                label="Message"
                value={freeText}
                onChange={(e) => setFreeText(e.target.value)}
                size="small"
                fullWidth
                sx={{ maxWidth: 500 }}
              />
              <Button variant="outlined" startIcon={<Send />} disabled={sending} onClick={() => handleSend("text")}>
                Send text
              </Button>
            </Stack>
          </Stack>
        </Paper>
      )}

      {/* Message log */}
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
          <Typography variant="h6">Recent messages</Typography>
          <Button size="small" startIcon={<Refresh />} onClick={loadAll}>
            Refresh
          </Button>
        </Stack>
        {messages.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No messages yet.
          </Typography>
        ) : (
          <TableContainer sx={{ overflowX: "auto" }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Time</TableCell>
                  <TableCell>Direction</TableCell>
                  <TableCell>Number</TableCell>
                  <TableCell>Content</TableCell>
                  <TableCell>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {messages.map((m) => (
                  <TableRow key={m.id} hover>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>{new Date(m.createdAt).toLocaleString()}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={m.direction === "OUTBOUND" ? "Out" : "In"}
                        color={m.direction === "OUTBOUND" ? "info" : "default"}
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>{m.counterparty}</TableCell>
                    <TableCell sx={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {m.templateName ? `[template] ${m.templateName}` : m.body || "—"}
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Chip size="small" label={m.status} color={statusChipColor(m.status)} variant="outlined" />
                        {m.error && (
                          <Typography variant="caption" color="error">
                            {m.error}
                          </Typography>
                        )}
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>

      {/* Disconnect confirm */}
      <Dialog open={disconnectOpen} onClose={() => setDisconnectOpen(false)}>
        <DialogTitle>Disconnect WhatsApp?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            AIMS will stop sending and receiving WhatsApp messages for this organization. The number stays registered
            with Meta and can be reconnected later.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDisconnectOpen(false)}>Cancel</Button>
          <Button color="warning" variant="contained" onClick={handleDisconnect}>
            Disconnect
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
