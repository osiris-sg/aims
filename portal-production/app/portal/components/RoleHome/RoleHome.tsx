"use client";

// Role-based home screen (guru 2026-11-06, from the ui-roles-demo mock-up:
// "keep the core functions as AIMS, just change the UI/UX to follow that").
//
// Layout, in the mock-up's order: greeting banner → two summary cards → the
// priorities list (urgent row highlighted) → business overview with
// sparklines → quick actions (3 of 4, customisable) → the assistant panel.
// A "Viewing as" switcher re-cuts the whole screen for the three roles.
//
// The FUNCTIONS are AIMS's: every row and tile opens a real screen or runs the
// real create flow. The NUMBERS are the org's own (guru 2026-11-12: "make sure
// all the data is correct and not sample data"): one snapshot from
// GET /dashboard/role-home, cut per role in roles.ts; the weather is the
// live reading for the browser's time zone.

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, IconButton, MenuItem, Select, Stack, Typography, alpha, lighten, useTheme,
} from "@mui/material";
import Checkbox from "@mui/material/Checkbox";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import TuneIcon from "@mui/icons-material/Tune";
import BoltIcon from "@mui/icons-material/Bolt";
import InsightsOutlinedIcon from "@mui/icons-material/InsightsOutlined";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import EventAvailableOutlinedIcon from "@mui/icons-material/EventAvailableOutlined";
import PendingActionsOutlinedIcon from "@mui/icons-material/PendingActionsOutlined";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import WbSunnyOutlinedIcon from "@mui/icons-material/WbSunnyOutlined";
import SendIcon from "@mui/icons-material/Send";
import { useUser } from "@clerk/nextjs";
import { useOrganization } from "@/app/portal/hooks/useOrganization";
import { useAccountingApi } from "@/app/portal/accounting/_lib/api";
import { openAimee } from "@/app/portal/chat/homeView";
import { AimeeKeyframes, AimeeRobot } from "./Aimee";
import { useCreateDocumentFlow } from "@/app/portal/components/useCreateDocumentFlow";
import { withActiveOrg } from "@/helpers/request";
import { QUICK_ACTIONS, ROLES, ROLE_ORDER, type Metric, type Priority, type QuickActionId, type Snapshot, type Summary } from "./roles";
import { RoleIcon, ICON_TONE } from "./icons";
import { useRoleView } from "./useRoleView";

// The mock-up's palette. Ink/surface come from the theme so dark mode works;
// the accents are the same in both.
const TEAL = "#1BA39C";
const NAVY = "#2B2257";
const RED = "#E5293F";

const greetingFor = (d: Date) => (d.getHours() < 12 ? "Good morning" : d.getHours() < 18 ? "Good afternoon" : "Good evening");

/** Card surface shared by every block — the mock-up's `.aims-card` (App.css):
 *  white, 14px radius, the same two-layer shadow, no border. Dark theme keeps
 *  the shape and swaps the shadow for a hairline, since shadows vanish there. */
const useCardSx = () => {
  const t = useTheme();
  const dark = t.palette.mode === "dark";
  return {
    borderRadius: "14px",
    bgcolor: dark ? "background.paper" : "#FFFFFF",
    border: dark ? `1px solid ${alpha("#fff", 0.08)}` : "none",
    boxShadow: dark ? "none" : "0 1px 2px rgba(28, 26, 51, 0.04), 0 4px 16px rgba(28, 26, 51, 0.05)",
  } as const;
};

// ── Sparkline ────────────────────────────────────────────────────────────
// One series, one hue, no axes — a trend mark beside a figure that states its
// own value and % change in text, so the line is never the only encoding.
function Sparkline({ data, color = TEAL }: { data: number[]; color?: string }) {
  const id = React.useId();
  if (data.length < 2) return null;
  const w = 100;
  const h = 28;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, h - ((v - min) / span) * (h - 4) - 2] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;
  return (
    <Box component="svg" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" sx={{ width: "100%", height: 34, display: "block" }} aria-hidden>
      <defs>
        <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.28} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#spark-${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </Box>
  );
}

// ── Greeting banner ──────────────────────────────────────────────────────
// The mock-up's Greeting.jsx: a 130px band, the Singapore skyline filling the
// right 70%, and a white curve sweeping over its left edge so the greeting
// sits on a clean surface. Same image the mock-up loads (its own CDN URL); if
// it fails the band simply shows its tint.
const SKYLINE =
  "https://static.prod-images.emergentagent.com/jobs/a605cd83-f653-41dd-80d1-bba56175a9ed/images/a9ab420a121eac5c614c3693040a603e259a16fc1fb2a2f419e6ab98fd8089a4.jpeg";

// Live weather for where the user is: the browser's time zone picks the city
// (open-meteo, no key). Unknown zone or a failed call → no weather shown,
// never a made-up reading.
const CITY_BY_ZONE: Record<string, [number, number]> = {
  "Asia/Singapore": [1.3521, 103.8198],
  "Asia/Kuala_Lumpur": [3.139, 101.6869],
  "Asia/Jakarta": [-6.2088, 106.8456],
  "Asia/Bangkok": [13.7563, 100.5018],
  "Asia/Manila": [14.5995, 120.9842],
  "Asia/Ho_Chi_Minh": [10.8231, 106.6297],
  "Asia/Hong_Kong": [22.3193, 114.1694],
  "Asia/Tokyo": [35.6762, 139.6503],
  "Asia/Seoul": [37.5665, 126.978],
  "Asia/Shanghai": [31.2304, 121.4737],
  "Asia/Taipei": [25.033, 121.5654],
  "Asia/Kolkata": [19.076, 72.8777],
  "Asia/Dubai": [25.2048, 55.2708],
  "Australia/Sydney": [-33.8688, 151.2093],
  "Australia/Melbourne": [-37.8136, 144.9631],
  "Australia/Perth": [-31.9505, 115.8605],
  "Europe/London": [51.5072, -0.1276],
  "America/New_York": [40.7128, -74.006],
  "America/Los_Angeles": [34.0522, -118.2437],
};
const WEATHER_WORDS: Array<[number, string]> = [
  [0, "Clear sky"], [1, "Mainly clear"], [2, "Partly cloudy"], [3, "Overcast"], [45, "Fog"], [48, "Fog"],
  [51, "Light drizzle"], [53, "Drizzle"], [55, "Drizzle"], [61, "Light rain"], [63, "Rain"], [65, "Heavy rain"],
  [66, "Freezing rain"], [67, "Freezing rain"], [71, "Snow"], [73, "Snow"], [75, "Heavy snow"], [77, "Snow"],
  [80, "Showers"], [81, "Showers"], [82, "Heavy showers"], [85, "Snow showers"], [86, "Snow showers"],
  [95, "Thunderstorm"], [96, "Thunderstorm"], [99, "Thunderstorm"],
];
function useWeather() {
  const [w, setW] = React.useState<{ temp: number; words: string } | null>(null);
  React.useEffect(() => {
    let zone = "";
    try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { /* no zone → no weather */ }
    const city = CITY_BY_ZONE[zone];
    if (!city) return;
    const ctrl = new AbortController();
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${city[0]}&longitude=${city[1]}&current=temperature_2m,weather_code`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const temp = Number(j?.current?.temperature_2m);
        const code = Number(j?.current?.weather_code);
        if (!Number.isFinite(temp)) return;
        setW({ temp: Math.round(temp), words: WEATHER_WORDS.find(([c]) => c === code)?.[1] ?? "" });
      })
      .catch(() => { /* offline → no weather */ });
    return () => ctrl.abort();
  }, []);
  return w;
}

function Greeting({ children }: { children?: React.ReactNode }) {
  const { user } = useUser();
  const t = useTheme();
  const dark = t.palette.mode === "dark";
  const [now, setNow] = React.useState<Date | null>(null);
  const [imgOk, setImgOk] = React.useState(true);
  const weather = useWeather();
  React.useEffect(() => setNow(new Date()), []);
  // Clerk's firstName is often blank on seeded accounts — fall back to the
  // full name, then the email local part, before the generic greeting.
  const emailName = user?.primaryEmailAddress?.emailAddress?.split("@")[0]?.replace(/[._-]+/g, " ");
  const first = user?.firstName || user?.fullName?.split(" ")[0] || user?.username || emailName || "there";
  // The surface the greeting sits on, and the tint behind the picture.
  const surface = dark ? t.palette.background.default : "#F4F6FB";
  const band = dark ? alpha(NAVY, 0.35) : "#EEF2FA";
  return (
    <Box sx={{ position: "relative", overflow: "hidden", height: { xs: "auto", md: 130 }, bgcolor: band }} data-testid="role-home-greeting">
      {imgOk && (
        <Box
          component="img"
          src={SKYLINE}
          alt="Singapore skyline"
          referrerPolicy="no-referrer"
          onError={() => setImgOk(false)}
          sx={{
            display: { xs: "none", md: "block" },
            position: "absolute", right: 0, top: 0, height: "100%", width: "70%",
            objectFit: "cover", objectPosition: "center 58%",
            opacity: dark ? 0.55 : 1,
          }}
        />
      )}
      {/* Curve blocker: solid surface on the left, then two swept shapes. */}
      <Box sx={{ position: "absolute", top: 0, bottom: 0, left: 0, display: { xs: "none", md: "flex" }, width: "calc(max(0px, (100% - 1440px) / 2) + 600px)" }}>
        <Box sx={{ flex: 1, bgcolor: surface }} />
        <Box component="svg" viewBox="0 0 260 100" preserveAspectRatio="none" aria-hidden sx={{ height: "100%", width: 260, flexShrink: 0, ml: "-1px" }}>
          <path d="M0,0 H260 C190,8 150,55 110,85 C95,95 80,100 60,100 H0 Z" fill={dark ? surface : "#FFFFFF"} opacity={0.5} />
          <path d="M0,0 H200 C140,12 110,60 70,88 C58,96 45,100 30,100 H0 Z" fill={surface} />
        </Box>
      </Box>
      <Box sx={{ display: { xs: "block", md: "none" }, position: "absolute", inset: 0, bgcolor: surface }} />
      <Stack
        direction={{ xs: "column", md: "row" }}
        alignItems={{ md: "center" }}
        justifyContent="space-between"
        gap={2}
        sx={{ position: "relative", maxWidth: 1440, mx: "auto", height: "100%", px: { xs: 2, md: 4 }, py: { xs: 2.5, md: 0 } }}
      >
        <Box className="aims-rise">
          <Typography sx={{ fontSize: { xs: 24, sm: 30, lg: 32 }, fontWeight: 600, lineHeight: 1.2, color: dark ? "text.primary" : "#1C1A33" }}>
            {now ? greetingFor(now) : "Hello"}, {first}
          </Typography>
          <Typography sx={{ mt: 0.5, fontSize: { xs: 14, md: 16 }, color: dark ? "text.secondary" : "#475569" }}>
            Here&apos;s what needs your attention today.
          </Typography>
          <Box sx={{ mt: 1.5, height: 3, width: 40, borderRadius: 999, bgcolor: TEAL }} />
        </Box>
        <Stack direction="row" alignItems="center" gap={2} flexWrap="wrap">
          <Stack
            direction="row"
            alignItems="center"
            gap={2.5}
            sx={{ display: { xs: "none", md: "flex" }, px: 2.5, py: 1.5, borderRadius: 4, bgcolor: dark ? alpha("#0B1033", 0.6) : "rgba(255,255,255,0.7)", backdropFilter: "blur(12px)", boxShadow: "0 1px 2px rgba(0,0,0,.05)" }}
          >
            {weather && (
              <>
                <Stack direction="row" alignItems="center" gap={1} data-testid="role-home-weather">
                  <WbSunnyOutlinedIcon sx={{ color: "#FBBF24", fontSize: 32 }} />
                  <Box sx={{ lineHeight: 1.2 }}>
                    <Typography sx={{ fontSize: 20, fontWeight: 600, lineHeight: 1.2 }}>{weather.temp}°C</Typography>
                    {weather.words && <Typography sx={{ fontSize: 11, color: "text.secondary" }}>{weather.words}</Typography>}
                  </Box>
                </Stack>
                <Box sx={{ height: 36, width: "1px", bgcolor: dark ? alpha("#fff", 0.2) : "#CBD5E1" }} />
              </>
            )}
            <Typography sx={{ fontSize: 14 }}>
              {now ? now.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : ""}
            </Typography>
          </Stack>
          {children}
        </Stack>
      </Stack>
    </Box>
  );
}

// ── "Viewing as" role switcher ───────────────────────────────────────────
function RoleSwitch({ roleId, onChange }: { roleId: string; onChange: (id: any) => void }) {
  return (
    <FormControl size="small">
      <Select
        value={roleId}
        onChange={(e) => onChange(e.target.value)}
        data-testid="role-home-role-switch"
        sx={{ borderRadius: 3, minWidth: 220, bgcolor: "background.paper", "& .MuiSelect-select": { py: 1 } }}
        renderValue={(v) => (
          <Stack direction="row" alignItems="center" gap={1}>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>Viewing as</Typography>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{ROLES[v as keyof typeof ROLES].title}</Typography>
          </Stack>
        )}
      >
        {ROLE_ORDER.map((id) => (
          <MenuItem key={id} value={id} data-testid={`role-option-${id}`}>
            {ROLES[id].title}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}

// ── Due today / Pending ──────────────────────────────────────────────────
function SummaryCards({ items }: { items: Summary[] }) {
  const card = useCardSx();
  const router = useRouter();
  const t = useTheme();
  const icons = [EventAvailableOutlinedIcon, PendingActionsOutlinedIcon];
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2 }}>
      {items.map((it, i) => {
        const Icon = icons[i] ?? EventAvailableOutlinedIcon;
        return (
          <Box
            key={it.label}
            role="button"
            tabIndex={0}
            onClick={() => router.push(withActiveOrg(it.href))}
            onKeyDown={(e) => e.key === "Enter" && router.push(withActiveOrg(it.href))}
            data-testid={`role-home-summary-${i}`}
            sx={{
              ...card,
              p: 2.5,
              display: "flex",
              alignItems: "center",
              gap: 2.5,
              cursor: "pointer",
              transition: "transform .15s, box-shadow .15s",
              "&:hover": { transform: "translateY(-2px)" },
            }}
          >
            <Box sx={{ height: 56, width: 56, borderRadius: "50%", display: "grid", placeItems: "center", bgcolor: t.palette.mode === "dark" ? alpha("#fff", 0.08) : "#EEF0F8" }}>
              <Icon sx={{ fontSize: 28 }} />
            </Box>
            <Box sx={{ flex: 1 }}>
              <Typography sx={{ fontSize: 15, fontWeight: 500 }}>{it.label}</Typography>
              <Stack direction="row" alignItems="baseline" gap={1}>
                <Typography sx={{ fontSize: 30, fontWeight: 600, lineHeight: 1.2, fontVariantNumeric: "tabular-nums" }}>{it.count === null ? "—" : it.count.toLocaleString("en-SG")}</Typography>
                <Typography variant="body2" sx={{ color: "text.secondary" }}>{it.unit}</Typography>
              </Stack>
            </Box>
            <ChevronRightIcon sx={{ color: "text.secondary" }} />
          </Box>
        );
      })}
    </Box>
  );
}

// ── Your priorities ──────────────────────────────────────────────────────
function Priorities({ title, badge, rows, loading }: { title: string; badge: string; rows: Priority[]; loading: boolean }) {
  const card = useCardSx();
  const router = useRouter();
  const t = useTheme();
  const dark = t.palette.mode === "dark";
  return (
    <Box sx={{ ...card, p: { xs: 2, md: 2.5 } }} data-testid="role-home-priorities">
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1.5}>
        <Stack direction="row" alignItems="center" gap={1.5}>
          <ErrorOutlineIcon />
          <Typography sx={{ fontSize: 18, fontWeight: 600 }}>{title}</Typography>
        </Stack>
        <Chip
          size="small"
          label={loading ? "…" : `${rows.length} ${badge}`}
          sx={rows.length
            ? { bgcolor: dark ? alpha(RED, 0.3) : "#FDE6EA", color: dark ? "#FFB4BE" : RED, fontWeight: 500, fontSize: 14, height: 28, px: 0.5 }
            : { bgcolor: dark ? alpha("#fff", 0.1) : "#EEF0F8", color: "text.secondary", fontWeight: 500, fontSize: 14, height: 28, px: 0.5 }}
        />
      </Stack>
      {!loading && rows.length === 0 && (
        <Typography data-testid="role-home-priorities-empty" sx={{ py: 3, textAlign: "center", color: "text.secondary", fontSize: 15 }}>
          Nothing needs attention right now.
        </Typography>
      )}
      <Stack>
        {rows.map((p, i) => (
          <Stack
            key={p.title}
            direction="row"
            alignItems="center"
            gap={2}
            data-testid={`role-home-priority-${i}`}
            sx={{
              px: 1.5,
              py: 1.5,
              borderRadius: 2,
              ...(p.urgent
                // Tint only — no red left stripe (guru 2026-11-12: "remove this
                // dark area everywhere for any card").
                // Dark mode (guru 2026-11-12: "make sure the colour contrast is
                // easier to see"): stronger tint plus a red outline.
                ? { bgcolor: dark ? alpha(RED, 0.24) : "#FDE6EA", ...(dark ? { boxShadow: `inset 0 0 0 1px ${alpha(RED, 0.55)}` } : {}) }
                : { borderBottom: "1px solid", borderColor: "divider", "&:last-of-type": { borderBottom: "none" } }),
            }}
          >
            <Box sx={{ height: 40, width: 40, borderRadius: "50%", display: "grid", placeItems: "center", bgcolor: alpha(ICON_TONE[p.icon] ?? TEAL, dark ? 0.28 : 0.12), color: dark ? lighten(ICON_TONE[p.icon] ?? TEAL, 0.35) : ICON_TONE[p.icon] ?? TEAL }}>
              <RoleIcon name={p.icon} fontSize="small" />
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ fontSize: 15, fontWeight: 500, lineHeight: 1.35 }}>{p.title}</Typography>
              <Typography sx={{ fontSize: 12, color: dark ? "text.secondary" : "#64748B" }}>{p.area} • {p.note}</Typography>
            </Box>
            <Button
              size="small"
              endIcon={<ChevronRightIcon />}
              onClick={() => router.push(withActiveOrg(p.href))}
              data-testid={`role-home-priority-action-${i}`}
              sx={{
                borderRadius: 999,
                px: 2,
                textTransform: "none",
                fontWeight: 500,
                fontSize: 14,
                ...(p.urgent
                  // Dark: navy on the maroon row was near-invisible — use the
                  // dark theme's lavender primary with ink text instead.
                  ? dark
                    ? { bgcolor: "#B9B0F2", color: "#1C1A33", "&:hover": { bgcolor: "#CFC8F7" } }
                    : { bgcolor: NAVY, color: "#fff", "&:hover": { bgcolor: "#3A2F72" } }
                  : { bgcolor: dark ? alpha("#fff", 0.12) : "#EEF0F8", color: dark ? "text.primary" : "#1C1A33", "&:hover": { bgcolor: dark ? alpha("#fff", 0.2) : "#E2E5F2" } }),
              }}
            >
              {p.action}
            </Button>
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}

// ── Business overview ────────────────────────────────────────────────────
export const RANGES: Record<string, string> = { "7": "Last 7 days", "30": "Last 30 days", "90": "Last 90 days" };

// A daily series folded into at most 14 points so the line reads at any range
// (sum the flows; a balance line keeps the last value of each fold).
function fold(data: number[], balance: boolean): number[] {
  if (data.length <= 14) return data;
  const size = Math.ceil(data.length / 14);
  const out: number[] = [];
  for (let i = 0; i < data.length; i += size) {
    const chunk = data.slice(i, i + size);
    out.push(balance ? chunk[chunk.length - 1] : chunk.reduce((a, b) => a + b, 0));
  }
  return out;
}

function Overview({ metrics, range, setRange }: { metrics: Metric[]; range: string; setRange: (v: string) => void }) {
  const card = useCardSx();
  const t = useTheme();
  const dark = t.palette.mode === "dark";
  return (
    <Box sx={{ ...card, p: { xs: 2, md: 2.5 } }} data-testid="role-home-overview">
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={2} gap={1} flexWrap="wrap">
        <Stack direction="row" alignItems="center" gap={1.5}>
          <InsightsOutlinedIcon />
          <Typography sx={{ fontSize: 18, fontWeight: 600 }}>Business overview</Typography>
        </Stack>
        <Select size="small" value={range} onChange={(e) => setRange(e.target.value)} data-testid="role-home-range" sx={{ borderRadius: 2, minWidth: 150 }}>
          {Object.entries(RANGES).map(([v, label]) => (
            <MenuItem key={v} value={v}>{label}</MenuItem>
          ))}
        </Select>
      </Stack>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", xl: "repeat(4, 1fr)" }, gap: 2 }}>
        {metrics.map((m, i) => {
          const down = m.dir === "down";
          const tone = m.bad ? RED : "#059669";
          return (
            <Box key={m.label} data-testid={`role-home-metric-${i}`} sx={{ borderRadius: "12px", border: "1px solid", borderColor: dark ? alpha("#fff", 0.08) : "#F1F5F9", bgcolor: dark ? "transparent" : "#FFFFFF", p: 2, transition: "box-shadow .15s", "&:hover": { boxShadow: dark ? "none" : "0 4px 6px -1px rgba(0,0,0,.1), 0 2px 4px -2px rgba(0,0,0,.1)" } }}>
              <Stack direction="row" alignItems="center" gap={1.5}>
                <Box sx={{ height: 32, width: 32, borderRadius: "50%", display: "grid", placeItems: "center", bgcolor: alpha(ICON_TONE[m.icon] ?? TEAL, dark ? 0.28 : 0.12), color: dark ? lighten(ICON_TONE[m.icon] ?? TEAL, 0.35) : ICON_TONE[m.icon] ?? TEAL }}>
                  <RoleIcon name={m.icon} sx={{ fontSize: 18 }} />
                </Box>
                <Typography variant="body2">{m.label}</Typography>
              </Stack>
              <Typography sx={{ fontSize: 20, fontWeight: 600, mt: 0.5, pl: 5.5, fontVariantNumeric: "tabular-nums" }}>{m.value}</Typography>
              {m.change && (
                <Stack direction="row" alignItems="center" gap={0.5} sx={{ pl: 5.5, color: dark && !m.bad ? "#4ADE9B" : tone }}>
                  {down ? <ArrowDownwardIcon sx={{ fontSize: 16 }} /> : <ArrowUpwardIcon sx={{ fontSize: 16 }} />}
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{m.change}</Typography>
                </Stack>
              )}
              {m.sub && <Typography sx={{ pl: 5.5, fontSize: 11, color: dark ? "text.secondary" : "#64748B" }}>{m.sub}</Typography>}
              {m.data && m.data.length > 1 && (
                <Box sx={{ mt: 1 }}>
                  <Sparkline data={fold(m.data, m.label === "Cash Balance")} color={m.bad ? RED : TEAL} />
                </Box>
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

// ── Quick actions ────────────────────────────────────────────────────────
function QuickActions({
  pool,
  active,
  onSave,
}: {
  pool: QuickActionId[];
  active: QuickActionId[];
  onSave: (next: QuickActionId[]) => void;
}) {
  const card = useCardSx();
  const t = useTheme();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [picked, setPicked] = React.useState<QuickActionId[]>(active);
  // One create flow per tile that creates a document — the same hook the
  // "Create <type>" buttons use, so numbering, template and number-format
  // pickers all behave exactly as they do elsewhere.
  const [pendingType, setPendingType] = React.useState<{ type: string; label: string } | null>(null);
  const { create, creating, dialogs } = useCreateDocumentFlow(pendingType?.type, pendingType?.label ?? "document");
  React.useEffect(() => {
    if (pendingType) void create().finally(() => setPendingType(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingType]);

  const run = (id: QuickActionId) => {
    const a = QUICK_ACTIONS[id];
    if (a.createType) setPendingType({ type: a.createType, label: a.label.replace(/^Create |^New /, "") });
    else if (a.href) router.push(withActiveOrg(a.href));
  };

  return (
    <Box sx={{ ...card, p: { xs: 2, md: 2.5 } }} data-testid="role-home-quick-actions">
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={2}>
        <Stack direction="row" alignItems="center" gap={1}>
          <BoltIcon sx={{ color: TEAL }} />
          <Typography sx={{ fontSize: 18, fontWeight: 600 }}>Quick actions</Typography>
        </Stack>
        <Button
          size="small"
          startIcon={<TuneIcon />}
          onClick={() => { setPicked(active); setOpen(true); }}
          data-testid="role-home-customise"
          sx={{ textTransform: "none", color: TEAL }}
        >
          Customise
        </Button>
      </Stack>
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1.5 }}>
        {active.map((id) => (
          <Box
            key={id}
            role="button"
            tabIndex={0}
            onClick={() => run(id)}
            onKeyDown={(e) => e.key === "Enter" && run(id)}
            data-testid={`role-home-action-${id}`}
            sx={{
              height: 96,
              borderRadius: "12px",
              bgcolor: t.palette.mode === "dark" ? alpha("#fff", 0.06) : "#F4F6FB",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 1,
              px: 1,
              textAlign: "center",
              cursor: creating ? "progress" : "pointer",
              transition: "transform .15s, background-color .15s",
              "&:hover": { bgcolor: t.palette.mode === "dark" ? alpha("#fff", 0.12) : "#ECEAF7", transform: "translateY(-2px)" },
            }}
          >
            <RoleIcon name={QUICK_ACTIONS[id].icon} />
            <Typography sx={{ fontSize: 13, lineHeight: 1.25 }}>{QUICK_ACTIONS[id].label}</Typography>
          </Box>
        ))}
      </Box>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 600 }}>Customise quick actions</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" sx={{ color: "text.secondary", mb: 1.5 }}>
            Choose 3 of {pool.length}. ({picked.length}/3 selected)
          </Typography>
          <Stack gap={1}>
            {pool.map((id) => {
              const on = picked.includes(id);
              const full = !on && picked.length >= 3;
              return (
                <Stack
                  key={id}
                  direction="row"
                  alignItems="center"
                  gap={1.5}
                  onClick={() => !full && setPicked((p) => (on ? p.filter((x) => x !== id) : [...p, id]))}
                  data-testid={`role-home-customise-${id}`}
                  sx={{
                    px: 1.5, py: 1, borderRadius: 2, border: "1px solid",
                    borderColor: on ? TEAL : "divider",
                    bgcolor: on ? alpha(TEAL, 0.08) : "transparent",
                    opacity: full ? 0.5 : 1,
                    cursor: full ? "not-allowed" : "pointer",
                  }}
                >
                  <Checkbox checked={on} disabled={full} size="small" sx={{ p: 0.5 }} />
                  <RoleIcon name={QUICK_ACTIONS[id].icon} fontSize="small" />
                  <Typography variant="body2">{QUICK_ACTIONS[id].label}</Typography>
                </Stack>
              );
            })}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} sx={{ textTransform: "none" }}>Cancel</Button>
          <Button
            variant="contained"
            disabled={picked.length !== 3}
            onClick={() => { onSave(picked); setOpen(false); }}
            data-testid="role-home-customise-save"
            sx={{ borderRadius: 999, textTransform: "none", px: 3 }}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>
      {dialogs}
    </Box>
  );
}

// ── Assistant ────────────────────────────────────────────────────────────
function AssistantCard({ prompts }: { prompts: string[] }) {
  const card = useCardSx();
  const t = useTheme();
  const dark = t.palette.mode === "dark";
  const [text, setText] = React.useState("");
  const ask = (prompt?: string) => {
    const msg = (prompt ?? text).trim();
    openAimee(msg ? { prompt: msg } : {});
    setText("");
  };
  return (
    <Box
      sx={{
        ...card,
        p: { xs: 2, md: 2.5 },
        position: "relative",
        overflow: "hidden",
        // The mock-up's panel: white fading to #EAF6F7.
        background: dark
          ? `linear-gradient(135deg, ${alpha(NAVY, 0.4)}, ${alpha(TEAL, 0.12)})`
          : "linear-gradient(135deg, #FFFFFF, #EAF6F7)",
      }}
      data-testid="role-home-assistant"
    >
      <Stack direction="row" alignItems="center" gap={2}>
        <AimeeRobot size={84} />
        <Box>
          <Typography sx={{ fontSize: 18, fontWeight: 600 }}>How can I help you today?</Typography>
          <Typography variant="caption" sx={{ color: "text.secondary" }}>Ask anything, or pick a suggestion.</Typography>
        </Box>
      </Stack>
      <Stack direction="row" gap={1} flexWrap="wrap" sx={{ mt: 2 }}>
        {prompts.map((p, i) => (
          <Chip
            key={p}
            label={p}
            onClick={() => ask(p)}
            data-testid={`role-home-prompt-${i}`}
            sx={{ bgcolor: "background.paper", border: "1px solid", borderColor: "divider", "&:hover": { borderColor: TEAL, color: TEAL } }}
          />
        ))}
      </Stack>
      <Box
        component="form"
        onSubmit={(e: React.FormEvent) => { e.preventDefault(); ask(); }}
        sx={{ mt: 2, display: "flex", alignItems: "center", gap: 1, borderRadius: 999, border: "1px solid", borderColor: "divider", bgcolor: "background.paper", pl: 2, pr: 0.5, py: 0.5 }}
      >
        <Box
          component="input"
          value={text}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setText(e.target.value)}
          placeholder="Type your request…"
          data-testid="role-home-assistant-input"
          sx={{ flex: 1, border: "none", outline: "none", bgcolor: "transparent", color: "text.primary", fontSize: 14, py: 1, fontFamily: "inherit" }}
        />
        <IconButton type="submit" data-testid="role-home-assistant-send" sx={dark ? { bgcolor: "#B9B0F2", color: "#1C1A33", "&:hover": { bgcolor: "#CFC8F7" } } : { bgcolor: NAVY, color: "#fff", "&:hover": { bgcolor: "#3A2F72" } }} size="small">
          <SendIcon fontSize="small" />
        </IconButton>
      </Box>
    </Box>
  );
}

// ── The screen ───────────────────────────────────────────────────────────
// One snapshot per range; refetched when the range or the org changes.
function useRoleHomeSnapshot(days: string) {
  const { request } = useAccountingApi();
  const [snapshot, setSnapshot] = React.useState<Snapshot | null>(null);
  const [loading, setLoading] = React.useState(true);
  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    request<Snapshot>(`/dashboard/role-home?days=${days}&today=${today}&tzOffset=${now.getTimezoneOffset()}`)
      .then((s) => { if (alive) setSnapshot(s); })
      .catch(() => { if (alive) setSnapshot(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [request, days]);
  return { snapshot, loading };
}

export default function RoleHome() {
  const { roleId, setRoleId, role, activeShortcuts, setShortcuts } = useRoleView();
  const { organization } = useOrganization();
  const [range, setRange] = React.useState("30");
  const { snapshot, loading } = useRoleHomeSnapshot(range);
  const cut = React.useMemo(() => role.cut(snapshot), [role, snapshot]);
  return (
    <Box sx={{ minHeight: "100%", bgcolor: (th) => (th.palette.mode === "dark" ? "background.default" : "#F2F4FA") }} data-testid="role-home">
      <AimeeKeyframes />
      {/* The role switcher lives on the profile chip in RoleTopBar (desktop);
          the banner only carries it on phones, where that bar is hidden. */}
      <Greeting>
        <Box sx={{ display: { xs: "block", md: "none" } }}>
          <RoleSwitch roleId={roleId} onChange={setRoleId} />
        </Box>
      </Greeting>
      <Box sx={{ maxWidth: 1440, mx: "auto", px: { xs: 2, md: 4 }, py: 2.5 }}>
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "1fr 380px" }, gap: 2, alignItems: "start" }}>
          <Stack gap={2} className="aims-rise" key={`l-${roleId}`}>
            <SummaryCards items={cut.summary} />
            <Priorities title={role.prioritiesTitle ?? "Your priorities"} badge={role.prioritiesBadge ?? "pending"} rows={cut.priorities} loading={loading && !snapshot} />
            <Overview metrics={cut.overview} range={range} setRange={setRange} />
          </Stack>
          <Stack gap={2} className="aims-rise" key={`r-${roleId}`} sx={{ animationDelay: "120ms" }}>
            <QuickActions pool={role.actionPool} active={activeShortcuts} onSave={setShortcuts} />
            <AssistantCard prompts={role.prompts} />
          </Stack>
        </Box>
        <Typography variant="caption" sx={{ display: "block", mt: 2, color: "text.secondary" }}>
          {organization?.name ?? "This organisation"} • role-based home.
        </Typography>
      </Box>
    </Box>
  );
}
