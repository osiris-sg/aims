"use client";

// Repeating jobs and notes (WCT group, 2026-11-25): the "Repeat" field of the job and note forms, Google Calendar
// style (Does not repeat / Daily / Weekly on ... / Monthly ... / Annually ... / Every weekday / Custom), and the
// "This event / This and following events / All events" question for a repeating item.

import React, { useEffect, useState } from "react";
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Radio, RadioGroup, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import DateInput from "@/components/DateInput";
import { SCOPE_LABEL, WD_LONG, WD_SHORT, customRule, defaultCustom, pickerOf, repeatOptions, ruleOf, type CustomRepeat, type RepeatPreset, type RepeatScope } from "./repeat";

export interface RepeatValue {
  preset: RepeatPreset;
  custom: CustomRepeat;
  /** The rule the item had when the form opened (kept as is unless the field is changed). */
  stored: string | null;
  changed: boolean;
}

export const repeatValueOf = (rrule: string | null | undefined, date: string): RepeatValue => {
  const p = pickerOf(rrule, date);
  return { preset: p.preset, custom: p.custom, stored: rrule ?? null, changed: false };
};

/** The rule to save: the stored one when the field was not touched (a Google rule is never rewritten). */
export const repeatRuleToSave = (v: RepeatValue, date: string): string | null => (v.changed ? ruleOf(v.preset, date, v.custom) : v.stored);

export default function RepeatField({ date, value, onChange }: { date: string; value: RepeatValue; onChange: (v: RepeatValue) => void }) {
  const options = repeatOptions(date);
  const [customOpen, setCustomOpen] = useState(false);
  const [draft, setDraft] = useState<CustomRepeat>(value.custom);
  useEffect(() => setDraft(value.custom), [value.custom]);
  const shown = value.preset === "custom" ? (value.changed ? customRule(value.custom) : value.stored ?? customRule(value.custom)) : null;
  return (
    <>
      <TextField
        select
        label="Repeat"
        size="small"
        fullWidth
        value={value.preset}
        onChange={(e) => {
          const preset = e.target.value as RepeatPreset;
          if (preset === "custom") {
            setDraft(value.preset === "custom" ? value.custom : defaultCustom(date));
            setCustomOpen(true);
            return;
          }
          onChange({ ...value, preset, changed: true });
        }}
        SelectProps={{ renderValue: (v) => (v === "custom" ? `Custom: ${customLabel(value.changed ? value.custom : pickerOf(shown, date).custom)}` : options.find((o) => o.value === v)?.label ?? "Does not repeat") }}
        inputProps={{ "data-tour": "jobs-calendar-repeat" }}
      >
        {options.map((o) => (
          <MenuItem key={o.value} value={o.value}>
            {o.value === "custom" ? "Custom…" : o.label}
          </MenuItem>
        ))}
      </TextField>
      <Dialog open={customOpen} onClose={() => setCustomOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Custom repeat</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="body2">Every</Typography>
              <TextField size="small" type="number" value={draft.interval} onChange={(e) => setDraft({ ...draft, interval: Math.max(1, Number(e.target.value) || 1) })} inputProps={{ min: 1, max: 999 }} sx={{ width: 90 }} />
              <TextField select size="small" value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value as CustomRepeat["unit"] })} sx={{ flex: 1 }}>
                <MenuItem value="DAILY">{draft.interval > 1 ? "days" : "day"}</MenuItem>
                <MenuItem value="WEEKLY">{draft.interval > 1 ? "weeks" : "week"}</MenuItem>
                <MenuItem value="MONTHLY">{draft.interval > 1 ? "months" : "month"}</MenuItem>
                <MenuItem value="YEARLY">{draft.interval > 1 ? "years" : "year"}</MenuItem>
              </TextField>
            </Stack>
            {draft.unit === "WEEKLY" && (
              <ToggleButtonGroup size="small" value={draft.weekdays} onChange={(_e, v: number[]) => setDraft({ ...draft, weekdays: v.length ? v : draft.weekdays })} aria-label="Repeat on">
                {WD_SHORT.map((l, i) => (
                  <ToggleButton key={i} value={i} aria-label={WD_LONG[i]} sx={{ px: 1.5 }}>
                    {l}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            )}
            <RadioGroup value={draft.ends} onChange={(e) => setDraft({ ...draft, ends: e.target.value as CustomRepeat["ends"] })}>
              <FormControlLabel value="never" control={<Radio size="small" />} label="Never ends" />
              <Stack direction="row" alignItems="center" spacing={1}>
                <FormControlLabel value="on" control={<Radio size="small" />} label="Ends on" sx={{ minWidth: 110 }} />
                <DateInput size="small" value={draft.until} disabled={draft.ends !== "on"} onChange={(e) => setDraft({ ...draft, until: e.target.value })} InputLabelProps={{ shrink: true }} />
              </Stack>
              <Stack direction="row" alignItems="center" spacing={1}>
                <FormControlLabel value="after" control={<Radio size="small" />} label="Ends after" sx={{ minWidth: 110 }} />
                <TextField size="small" type="number" value={draft.count} disabled={draft.ends !== "after"} onChange={(e) => setDraft({ ...draft, count: Math.max(1, Number(e.target.value) || 1) })} inputProps={{ min: 1, max: 5000 }} sx={{ width: 90 }} />
                <Typography variant="body2">times</Typography>
              </Stack>
            </RadioGroup>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCustomOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={draft.ends === "on" && !/^\d{4}-\d{2}-\d{2}$/.test(draft.until)}
            onClick={() => {
              onChange({ ...value, preset: "custom", custom: draft, changed: true });
              setCustomOpen(false);
            }}
          >
            Done
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

function customLabel(c: CustomRepeat): string {
  const unit = { DAILY: "day", WEEKLY: "week", MONTHLY: "month", YEARLY: "year" }[c.unit];
  const every = c.interval > 1 ? `every ${c.interval} ${unit}s` : `every ${unit}`;
  const on = c.unit === "WEEKLY" && c.weekdays.length ? ` on ${c.weekdays.map((w) => WD_LONG[w].slice(0, 3)).join(", ")}` : "";
  const end = c.ends === "on" && c.until ? `, until ${c.until}` : c.ends === "after" ? `, ${c.count} times` : "";
  return `${every}${on}${end}`;
}

/** "This event / This and following events / All events" (Google's question for a repeating item). */
export function RepeatScopeDialog({ open, title, allowThis = true, onPick, onClose }: { open: boolean; title: string; allowThis?: boolean; onPick: (s: RepeatScope) => void; onClose: () => void }) {
  const [scope, setScope] = useState<RepeatScope>(allowThis ? "this" : "following");
  useEffect(() => {
    if (open) setScope(allowThis ? "this" : "following");
  }, [open, allowThis]);
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <RadioGroup value={scope} onChange={(e) => setScope(e.target.value as RepeatScope)}>
          {(["this", "following", "all"] as RepeatScope[])
            .filter((s) => allowThis || s !== "this")
            .map((s) => (
              <FormControlLabel key={s} value={s} control={<Radio size="small" />} label={SCOPE_LABEL[s]} />
            ))}
        </RadioGroup>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => onPick(scope)}>
          OK
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** A promise-style "which events?" question: const scope = await ask("Edit repeating job"). */
export function useRepeatScope() {
  const [state, setState] = useState<{ title: string; resolve: (s: RepeatScope | null) => void } | null>(null);
  const ask = (title: string) => new Promise<RepeatScope | null>((resolve) => setState({ title, resolve }));
  const element = (
    <RepeatScopeDialog
      open={!!state}
      title={state?.title ?? ""}
      onPick={(s) => {
        state?.resolve(s);
        setState(null);
      }}
      onClose={() => {
        state?.resolve(null);
        setState(null);
      }}
    />
  );
  return { ask, element };
}
