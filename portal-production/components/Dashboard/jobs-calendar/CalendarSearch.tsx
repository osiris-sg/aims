"use client";

// Jobs calendar search (WCT group, enableGroupCalendar, 2026-11-23): a box in the filter row (2026-11-25: at its right
// end, just left of "Export list"). Month / Week / Day: searches every job and note of the companies shown, any date,
// on the server (300 ms after typing, 20 at most): customer, site, subject, remarks, job no., QO / Order / DO /
// Invoice nos., team / crew, workers; upcoming first, then past; a pick jumps the calendar to that day and opens it.
// Schedule view (filterMode, 2026-11-25): no dropdown; the text filters the Schedule list live (onText), the x or Esc
// clears it and every row shows again.

import React, { useEffect, useRef, useState } from "react";
import { Box, ClickAwayListener, IconButton, InputAdornment, List, ListItemButton, Paper, Popper, TextField, Typography } from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import CloseIcon from "@mui/icons-material/Close";

import { hitWhen, SEARCH_DEBOUNCE_MS, type CalendarSearchHit } from "@/helpers/calendarSearch";
export type { CalendarSearchHit } from "@/helpers/calendarSearch";

export default function CalendarSearch({
  search,
  onPick,
  filterMode = false,
  onText,
}: {
  search: (q: string) => Promise<CalendarSearchHit[]>;
  onPick: (hit: CalendarSearchHit) => void;
  /** Schedule view: the text filters the list on screen instead of opening the dropdown. */
  filterMode?: boolean;
  /** Every change of the text (also "" when cleared). */
  onText?: (q: string) => void;
}) {
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [hits, setHits] = useState<CalendarSearchHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement | null>(null);
  const latest = useRef("");

  useEffect(() => {
    const term = q.trim();
    latest.current = term;
    if (term.length < 2 || filterMode) {
      setHits(null);
      setBusy(false);
      return;
    }
    setBusy(true);
    const t = setTimeout(async () => {
      const list = await search(term).catch(() => [] as CalendarSearchHit[]);
      if (latest.current !== term) return;
      setHits(list);
      setBusy(false);
      // Opens only while the person is in the box (not when the view changes with text in it).
      if (typeof document !== "undefined" && document.activeElement === inputRef.current) setOpen(true);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q, search, filterMode]);

  const clear = () => {
    setQ("");
    setHits(null);
    setOpen(false);
    onText?.("");
  };

  return (
    <ClickAwayListener onClickAway={() => setOpen(false)}>
      <Box ref={anchor} sx={{ width: { xs: "100%", sm: 260 } }}>
        <TextField
          size="small"
          fullWidth
          placeholder="Search jobs"
          value={q}
          inputRef={inputRef}
          onChange={(e) => {
            setQ(e.target.value);
            onText?.(e.target.value);
            if (!filterMode) setOpen(true);
          }}
          onFocus={() => hits && !filterMode && setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") clear();
          }}
          inputProps={{ "aria-label": "Search jobs", "data-tour": "jobs-calendar-search" }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
            endAdornment: q ? (
              <InputAdornment position="end">
                <IconButton size="small" aria-label="Clear search" onClick={clear}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              </InputAdornment>
            ) : undefined,
          }}
        />
        <Popper open={open && !filterMode && q.trim().length >= 2} anchorEl={anchor.current} placement="bottom-start" sx={{ zIndex: 1300, width: { xs: "calc(100% - 32px)", sm: 440 } }}>
          <Paper elevation={6} sx={{ mt: 0.5, maxHeight: 420, overflowY: "auto" }}>
            {busy && !hits ? (
              <Typography variant="body2" color="text.secondary" sx={{ p: 1.5 }}>
                Searching
              </Typography>
            ) : !hits?.length ? (
              <Typography variant="body2" color="text.secondary" sx={{ p: 1.5 }}>
                No jobs or notes match
              </Typography>
            ) : (
              <List dense disablePadding>
                {hits.map((h) => (
                  <ListItemButton
                    key={`${h.orgId}:${h.id}`}
                    onClick={() => {
                      setOpen(false);
                      onPick(h);
                    }}
                    sx={{ display: "block", py: 0.75, borderBottom: 1, borderColor: "divider" }}
                  >
                    <Box sx={{ display: "flex", gap: 1, alignItems: "baseline" }}>
                      <Typography variant="body2" sx={{ fontWeight: 600, whiteSpace: "nowrap" }}>
                        {hitWhen(h)}
                      </Typography>
                      {h.icons && (
                        <Typography variant="body2" component="span">
                          {h.icons}
                        </Typography>
                      )}
                      <Typography variant="caption" color="text.secondary" sx={{ ml: "auto", whiteSpace: "nowrap" }}>
                        {h.orgName}
                      </Typography>
                    </Box>
                    <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
                      {h.kind === "note" ? h.label : [h.customer, h.label].filter(Boolean).join(" · ")}
                    </Typography>
                    {h.address && (
                      <Typography variant="caption" color="text.secondary" component="div" sx={{ overflowWrap: "anywhere" }}>
                        {h.address}
                      </Typography>
                    )}
                  </ListItemButton>
                ))}
              </List>
            )}
          </Paper>
        </Popper>
      </Box>
    </ClickAwayListener>
  );
}
