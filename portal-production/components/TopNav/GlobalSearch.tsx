"use client";

// Global search (guru 2026-10-03, all orgs — like Xero's top-right search):
// type any document number, client, project, supplier, lead name or phone and
// grouped results drop down with enough context to recognise each hit.
// Debounced 250ms; ↑↓ + Enter navigates; Esc closes. Results respect the
// caller's tier server-side (a designer only sees their own records).

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Box, Chip, CircularProgress, ClickAwayListener, InputAdornment, InputBase, List, ListItemButton, ListItemText, ListSubheader, Paper, Popper, Typography, useMediaQuery, useTheme } from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import { useAuth } from "@clerk/nextjs";

const apiBase = process.env.NEXT_PUBLIC_BACKEND_API_URL;

type Results = {
  documents: Array<{ id: string; number: string | null; type: string; status: string; customer: string | null; total: number | null; projectId: string | null; templateId: string | null; isIdQuote: boolean }>;
  projects: Array<{ id: string; name: string; address: string | null; stage: string | null; status: string; designer: string | null }>;
  customers: Array<{ id: string; name: string; customerCode: string | null; phone: string | null; email: string | null }>;
  suppliers: Array<{ id: string; name: string; supplierCode: string | null }>;
  leads: Array<{ id: string; name: string; phone: string | null; status: string; source: string; assignedToName: string | null }>;
};

const money = (n: number | null) => (n == null ? null : `S$ ${new Intl.NumberFormat("en-SG", { maximumFractionDigits: 0 }).format(n)}`);

export default function GlobalSearch() {
  const router = useRouter();
  const { getToken } = useAuth();
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down("md"));
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Results | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const anchor = useRef<HTMLDivElement>(null);
  const seqRef = useRef(0);

  // Flat list for keyboard navigation, in render order.
  const flat = useMemo(() => {
    if (!res) return [] as Array<{ group: string; label: string; sub: string; go: () => void }>;
    const out: Array<{ group: string; label: string; sub: string; go: () => void }> = [];
    for (const d of res.documents) {
      out.push({
        group: "Documents",
        label: `${d.number || "Draft"} · ${d.type}`,
        sub: [d.customer, d.status, money(d.total)].filter(Boolean).join(" · "),
        go: () => {
          if (d.type === "VARIATION_ORDER" && d.projectId) router.push(`/portal/projects/${d.projectId}?vo=${d.id}`);
          else if (d.isIdQuote && ["QUOTATION", "QO", "QO1", "QO2", "QT"].includes(d.type)) router.push(`/portal/sales/quotations/id/${d.id}`);
          else router.push(`/portal/documents/${d.type}/${d.templateId || "none"}/${d.id}`);
        },
      });
    }
    for (const p of res.projects) out.push({ group: "Projects", label: p.name, sub: [p.address, p.stage || (p.status === "completed" ? "completed" : "not signed"), p.designer].filter(Boolean).join(" · "), go: () => router.push(`/portal/projects/${p.id}`) });
    for (const l of res.leads) out.push({ group: "Leads", label: l.name, sub: [l.phone, l.source?.toUpperCase(), l.status, l.assignedToName].filter(Boolean).join(" · "), go: () => router.push(`/portal/sales/leads?focus=${l.id}`) });
    for (const c of res.customers) out.push({ group: "Customers", label: c.name, sub: [c.customerCode, c.phone, c.email].filter(Boolean).join(" · "), go: () => router.push(`/portal/customers?focus=${c.id}`) });
    for (const s of res.suppliers) out.push({ group: "Suppliers", label: s.name, sub: s.supplierCode || "", go: () => router.push(`/portal/suppliers?focus=${s.id}`) });
    return out;
  }, [res, router]);

  const run = useCallback(
    async (term: string) => {
      const seq = ++seqRef.current;
      if (term.trim().length < 2) {
        setRes(null);
        return;
      }
      setLoading(true);
      try {
        const token = await getToken();
        const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
        const activeOrgId = typeof window !== "undefined" ? window.sessionStorage.getItem("aims-admin-active-org") : null;
        if (activeOrgId) headers["X-Active-Org-Id"] = activeOrgId;
        const r = await fetch(`${apiBase}/search?q=${encodeURIComponent(term)}`, { headers });
        const j = await r.json();
        if (seq === seqRef.current) setRes(j?.data ?? j);
      } catch {
        /* type-ahead: silent */
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    },
    [getToken],
  );

  useEffect(() => {
    const t = setTimeout(() => run(q), 250);
    return () => clearTimeout(t);
  }, [q, run]);

  useEffect(() => setCursor(0), [flat.length]);

  const navigate = (i: number) => {
    const hit = flat[i];
    if (!hit) return;
    setOpen(false);
    setQ("");
    setRes(null);
    hit.go();
  };

  return (
    <ClickAwayListener onClickAway={() => setOpen(false)}>
      <Box ref={anchor} sx={{ position: "relative", mr: 0.5 }}>
        <InputBase
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => q && setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            else if (e.key === "ArrowDown") {
              e.preventDefault();
              setCursor((c) => Math.min(c + 1, flat.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setCursor((c) => Math.max(c - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              navigate(cursor);
            }
          }}
          placeholder={compact ? "Search" : "Search anything…"}
          startAdornment={
            <InputAdornment position="start" sx={{ color: "rgba(255,255,255,0.6)", ml: 0.5 }}>
              {loading ? <CircularProgress size={14} sx={{ color: "rgba(255,255,255,0.7)" }} /> : <SearchIcon sx={{ fontSize: 18 }} />}
            </InputAdornment>
          }
          sx={{
            color: "#fff",
            bgcolor: "rgba(255,255,255,0.1)",
            borderRadius: 1.5,
            px: 1,
            py: 0.25,
            fontSize: "0.8125rem",
            width: compact ? 120 : 170,
            transition: "width .15s, background .15s",
            "&:focus-within": { width: compact ? 180 : 320, bgcolor: "rgba(255,255,255,0.16)" },
            "& input::placeholder": { color: "rgba(255,255,255,0.55)", opacity: 1 },
          }}
          inputProps={{ "aria-label": "Global search" }}
          data-tour="global-search"
        />
        <Popper open={open && q.trim().length >= 2} anchorEl={anchor.current} placement="bottom-end" sx={{ zIndex: 1400 }}>
          <Paper elevation={8} sx={{ mt: 0.5, width: 420, maxWidth: "calc(100vw - 24px)", maxHeight: 480, overflowY: "auto", borderRadius: 2 }}>
            {flat.length === 0 ? (
              <Typography variant="body2" sx={{ p: 2, color: "text.secondary" }}>
                {loading ? "Searching…" : `Nothing matches “${q.trim()}”.`}
              </Typography>
            ) : (
              <List dense disablePadding>
                {flat.map((hit, i) => {
                  const header = i === 0 || flat[i - 1].group !== hit.group;
                  return (
                    <React.Fragment key={`${hit.group}-${i}`}>
                      {header && (
                        <ListSubheader disableSticky sx={{ lineHeight: "28px", fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase", bgcolor: "transparent" }}>
                          {hit.group}
                        </ListSubheader>
                      )}
                      <ListItemButton selected={i === cursor} onMouseEnter={() => setCursor(i)} onClick={() => navigate(i)} sx={{ py: 0.75 }}>
                        <ListItemText
                          primary={hit.label}
                          secondary={hit.sub || undefined}
                          primaryTypographyProps={{ variant: "body2", sx: { fontWeight: 600 } }}
                          secondaryTypographyProps={{ variant: "caption", sx: { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }}
                        />
                        {i === cursor && <Chip size="small" label="↵" sx={{ height: 18, fontSize: 10, ml: 1 }} />}
                      </ListItemButton>
                    </React.Fragment>
                  );
                })}
              </List>
            )}
          </Paper>
        </Popper>
      </Box>
    </ClickAwayListener>
  );
}
