/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Round BG — 出庫・納入依頼書 Deliveries, fast entry of truck days (Sayaka's Excel list: 納品日 · LOT · バンドル数/台):
//  - "Paste from Excel" → preview → "Add rows": one row per delivery day + LOT, bundles summed, trucks counted;
//  - 出荷日 = 納入日 − 1 working day (Saturdays, Sundays and Japanese public holidays skipped); a typed 出荷日 sticks
//    ("edited");
//  - "Add row" = the next working day after the last row; "Fill days…" makes several rows at once;
//  - rows always by 納入日; totals vs the B/L bundles (per LOT); weights per row from the LOT's average bundle weight.

import React, { useMemo, useState } from "react";
import { Alert, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, MenuItem, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Tooltip, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import ContentPasteIcon from "@mui/icons-material/ContentPaste";
import DateRangeIcon from "@mui/icons-material/DateRange";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useShipmentsApi } from "@/app/portal/shipments/_lib/api";
import { bundleTotals, daysBetween, groupSchedule, isEmptyRow, nextRow, parseSchedule, rowsFor, shipDateFor, sortRows, withDelivery, withWeights, type SiLot, type SiRow } from "@/app/portal/shipments/_lib/si-days";
import { tradeTodayYmd } from "@/app/portal/shipments/_lib/tasks";

const md = (d?: string | null) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : (d ?? ""));
const WD = { en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], ja: ["日", "月", "火", "水", "木", "金", "土"] };

export default function SiDeliveries({
  docId,
  rows,
  setRows,
  disabled,
  weightsPerRow,
  setWeightsPerRow,
  onDelivered,
  lang,
  requestDate,
}: {
  docId: string;
  rows: SiRow[];
  setRows: (fn: (rs: SiRow[]) => SiRow[]) => void;
  disabled: boolean;
  weightsPerRow: boolean;
  setWeightsPerRow: (v: boolean) => void;
  onDelivered: (rowIndex: number, v: boolean) => void;
  lang: "en" | "ja";
  requestDate?: string | null;
}) {
  const t = useTranslations("si.deliveries");
  const te = useTranslations("si.editor");
  const api = useShipmentsApi();
  const ctx = useQuery({ queryKey: ["si-context", docId], queryFn: () => api.siContext(docId), staleTime: 5 * 60_000, enabled: !!docId });
  const holidays = useMemo(() => new Set((ctx.data?.holidays ?? []).map((h) => h.date)), [ctx.data]);
  const holidayName = useMemo(() => new Map((ctx.data?.holidays ?? []).map((h) => [h.date, h.name])), [ctx.data]);
  const lots: SiLot[] = ctx.data?.lots ?? [];
  const today = tradeTodayYmd();
  const ref = requestDate && /^\d{4}-\d{2}-\d{2}$/.test(requestDate) ? requestDate : today;
  const destination = ctx.data?.destination ?? rows.find((r) => r.destination)?.destination ?? "";
  const [paste, setPaste] = useState<string | null>(null);
  const [fill, setFill] = useState<{ from: string; to: string; bundles: string; lot: string; skip: boolean } | null>(null);

  // Every change: weights follow the bundles (when per row), rows by 納入日, empty rows dropped once real rows are added.
  const commit = (next: SiRow[]) => setRows(() => sortRows(next.map((r) => (weightsPerRow ? withWeights(r, lots) : r))));
  const setRow = (i: number, patch: Partial<SiRow>, resort = false) =>
    setRows((rs) => {
      const out = rs.map((x, j) => (j === i ? { ...x, ...patch } : x)).map((r, j) => (j === i && weightsPerRow ? withWeights(r, lots) : r));
      return resort ? sortRows(out) : out;
    });
  const addRows = (more: SiRow[]) => commit([...rows.filter((r) => !isEmptyRow(r)), ...more]);

  const parsed = useMemo(() => (paste !== null && paste.trim() ? parseSchedule(paste, ref, lots.map((l) => l.lot)) : null), [paste, ref, lots]);
  const preview = useMemo(() => (parsed ? rowsFor(groupSchedule(parsed.lines), lots, destination, holidays) : []), [parsed, lots, destination, holidays]);
  const fillRows = useMemo(() => {
    if (!fill) return [];
    const lot = lots.find((l) => l.lot === fill.lot) ?? lots[0];
    const b = Math.floor(Number(fill.bundles) || 0);
    return daysBetween(fill.from, fill.to, holidays, fill.skip).map<SiRow>((d) => ({ shipDate: shipDateFor(d, holidays), deliveryDate: d, destination, billet: lot?.billet ?? rows[rows.length - 1]?.billet ?? "", bundles: b || null, lot: lot?.lot ?? null }));
  }, [fill, lots, holidays, destination, rows]);

  const totals = bundleTotals(rows, lots);
  const dayLabel = (d: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return "";
    const w = new Date(`${d}T00:00:00Z`).getUTCDay();
    const hol = holidayName.get(d);
    return `${WD[lang][w]}${hol ? ` · ${hol}` : ""}`;
  };
  const offDay = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && (holidays.has(d) || [0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay()));

  return (
    <Box data-tour="si-deliveries">
      {!disabled && (
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
          <Button size="small" variant="outlined" startIcon={<ContentPasteIcon />} onClick={() => setPaste("")} data-tour="si-paste">{t("paste")}</Button>
          <Button size="small" variant="outlined" startIcon={<DateRangeIcon />} onClick={() => { const n = nextRow(rows, holidays, today); setFill({ from: n.deliveryDate, to: n.deliveryDate, bundles: "", lot: n.lot ?? lots[0]?.lot ?? "", skip: true }); }} data-tour="si-fill-days">{t("fillDays")}</Button>
          <Box sx={{ flex: 1 }} />
          <FormControlLabel control={<Checkbox size="small" checked={weightsPerRow} onChange={(e) => { setWeightsPerRow(e.target.checked); setRows((rs) => rs.map((r) => (e.target.checked ? withWeights(r, lots) : { ...r, netMt: null, grossMt: null }))); }} />} label={<Typography variant="body2">{t("weightsPerRow")}</Typography>} data-tour="si-weights-per-row" />
        </Stack>
      )}
      <Box sx={{ overflowX: "auto", border: 1, borderColor: "divider", borderRadius: 1 }}>
        <Table size="small" sx={{ minWidth: 760 }}>
          <TableHead>
            <TableRow sx={{ "& th": { fontWeight: 700, whiteSpace: "nowrap" } }}>
              <TableCell sx={{ width: 170 }}>{te("deliveryDate")}</TableCell>
              <TableCell sx={{ width: 170 }}>{te("shipDate")}</TableCell>
              <TableCell sx={{ minWidth: 130 }}>{te("destination")}</TableCell>
              <TableCell sx={{ minWidth: 170 }}>{te("billet")}</TableCell>
              <TableCell align="right" sx={{ width: 80 }}>{te("bundles")}</TableCell>
              <TableCell align="right" sx={{ width: 60 }}>{t("trucks")}</TableCell>
              {weightsPerRow && <TableCell align="right" sx={{ width: 150 }}>{t("weights")}</TableCell>}
              <TableCell sx={{ width: 80 }}>{te("delivered")}</TableCell>
              <TableCell sx={{ width: 40 }} />
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={i} sx={{ opacity: isEmptyRow(r) ? 0.6 : 1 }}>
                <TableCell sx={{ p: 0.5 }}>
                  <TextField size="small" variant="standard" type="date" fullWidth value={r.deliveryDate ?? ""} disabled={disabled} inputProps={{ min: "2000-01-01", max: "2100-12-31", "aria-label": `${te("deliveryDate")} row ${i + 1}` }}
                    onChange={(e) => setRow(i, withDelivery(r, e.target.value, holidays))} onBlur={() => setRows((rs) => sortRows(rs))}
                    helperText={dayLabel(r.deliveryDate)} FormHelperTextProps={{ sx: { m: 0, color: offDay(r.deliveryDate) ? "warning.main" : undefined } }} />
                </TableCell>
                <TableCell sx={{ p: 0.5 }}>
                  <Stack direction="row" spacing={0.5} alignItems="flex-start">
                    <TextField size="small" variant="standard" type="date" fullWidth value={r.shipDate ?? ""} disabled={disabled} inputProps={{ min: "2000-01-01", max: "2100-12-31", "aria-label": `${te("shipDate")} row ${i + 1}` }}
                      onChange={(e) => setRow(i, { shipDate: e.target.value, shipDateEdited: e.target.value !== shipDateFor(r.deliveryDate, holidays) })}
                      helperText={dayLabel(r.shipDate)} FormHelperTextProps={{ sx: { m: 0, color: offDay(r.shipDate) ? "warning.main" : undefined } }} />
                    {r.shipDateEdited && (
                      <Tooltip title={t("editedTip")}>
                        <Chip size="small" label={t("edited")} onDelete={disabled ? undefined : () => setRow(i, { shipDate: shipDateFor(r.deliveryDate, holidays), shipDateEdited: false })} sx={{ height: 18, mt: 0.5, "& .MuiChip-label": { px: 0.5, fontSize: 10 } }} data-tour="si-shipdate-edited" />
                      </Tooltip>
                    )}
                  </Stack>
                </TableCell>
                <TableCell sx={{ p: 0.5 }}><TextField size="small" variant="standard" fullWidth value={r.destination ?? ""} disabled={disabled} onChange={(e) => setRow(i, { destination: e.target.value })} /></TableCell>
                <TableCell sx={{ p: 0.5 }}>
                  {lots.length > 1 && !disabled ? (
                    <TextField select size="small" variant="standard" fullWidth value={lots.some((l) => l.billet === r.billet) ? r.billet : "__typed"} onChange={(e) => { const l = lots.find((x) => x.billet === e.target.value); if (l) setRow(i, { billet: l.billet, lot: l.lot }); }} SelectProps={{ renderValue: () => <Typography variant="body2" sx={{ whiteSpace: "pre-line" }}>{r.billet}</Typography> }}>
                      {lots.map((l) => <MenuItem key={l.lot} value={l.billet} sx={{ whiteSpace: "pre-line" }}>{l.billet}</MenuItem>)}
                      <MenuItem value="__typed" disabled>{t("typed")}</MenuItem>
                    </TextField>
                  ) : (
                    <TextField size="small" variant="standard" fullWidth multiline value={r.billet ?? ""} disabled={disabled} onChange={(e) => setRow(i, { billet: e.target.value })} />
                  )}
                </TableCell>
                <TableCell sx={{ p: 0.5 }}><TextField size="small" variant="standard" type="number" fullWidth value={r.bundles ?? ""} disabled={disabled} inputProps={{ style: { textAlign: "right" }, min: 0 }} onChange={(e) => setRow(i, { bundles: e.target.value === "" ? null : Number(e.target.value) })} /></TableCell>
                <TableCell sx={{ p: 0.5 }}><TextField size="small" variant="standard" type="number" fullWidth value={r.trucks ?? ""} disabled={disabled} inputProps={{ style: { textAlign: "right" }, min: 0 }} onChange={(e) => setRow(i, { trucks: e.target.value === "" ? null : Number(e.target.value) })} /></TableCell>
                {weightsPerRow && <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}><Typography variant="caption" component="div">{r.grossMt != null ? `${t("grossShort")} ${r.grossMt.toFixed(3)}` : "—"}</Typography><Typography variant="caption" color="text.secondary" component="div">{r.netMt != null ? `${t("netShort")} ${r.netMt.toFixed(3)}` : ""}</Typography></TableCell>}
                <TableCell sx={{ p: 0.25 }}><Checkbox size="small" checked={r.delivered === true} onChange={(e) => onDelivered(i, e.target.checked)} inputProps={{ "aria-label": `${te("delivered")} row ${i + 1}` }} /></TableCell>
                <TableCell sx={{ p: 0.25 }}>{!disabled && <IconButton size="small" aria-label={t("remove")} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}><DeleteIcon fontSize="small" /></IconButton>}</TableCell>
              </TableRow>
            ))}
            <TableRow sx={{ "& td": { fontWeight: 700, fontVariantNumeric: "tabular-nums" } }}>
              <TableCell colSpan={4}>{te("total")}{lots.length ? ` · ${t("vsBl")}` : ""}</TableCell>
              <TableCell align="right">{totals.total || ""}</TableCell>
              <TableCell align="right">{rows.reduce((a, r) => a + (Number(r.trucks) || 0), 0) || ""}</TableCell>
              {weightsPerRow && <TableCell align="right">{(() => { const g = rows.reduce((a, r) => a + (Number(r.grossMt) || 0), 0); return g ? `${t("grossShort")} ${g.toFixed(3)}` : ""; })()}</TableCell>}
              <TableCell colSpan={2} />
            </TableRow>
          </TableBody>
        </Table>
      </Box>
      {!disabled && (
        <Button size="small" startIcon={<AddIcon />} sx={{ mt: 1 }} onClick={() => addRows([weightsPerRow ? withWeights(nextRow(rows, holidays, today), lots) : nextRow(rows, holidays, today)])} data-tour="si-add-row">
          {t("addRow")}
        </Button>
      )}
      {lots.length > 0 && (
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1 }} data-tour="si-bundle-totals">
          {totals.perLot.map((l) => (
            <Chip key={l.lot} size="small" variant="outlined" color={l.diff === 0 ? "success" : "warning"} label={t("lotTotal", { lot: l.lot, rows: String(l.rows), bl: String(l.bl), diff: l.diff > 0 ? `+${l.diff}` : String(l.diff) })} />
          ))}
          <Chip size="small" color={totals.diff === 0 ? "success" : "warning"} label={t("allTotal", { rows: String(totals.total), bl: String(totals.bl), diff: totals.diff > 0 ? `+${totals.diff}` : String(totals.diff) })} />
          {lots.some((l) => l.missing) && <Typography variant="caption" color="warning.main">{t("blMissing")}</Typography>}
        </Stack>
      )}
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
        {t("rules", { source: ctx.data?.holidaySource ?? "@holiday-jp/holiday_jp" })}
      </Typography>

      {/* Paste from Excel */}
      <Dialog open={paste !== null} onClose={() => setPaste(null)} maxWidth="md" fullWidth>
        <DialogTitle>{t("pasteTitle")}</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{t("pasteHelp")}</Typography>
          <TextField multiline minRows={6} maxRows={14} fullWidth autoFocus value={paste ?? ""} onChange={(e) => setPaste(e.target.value)} placeholder={"納品日\tLOT\tバンドル数/台\n11/9(月)\t6005\t8\n\t6005\t8"} inputProps={{ style: { fontFamily: "monospace", fontSize: 13 }, "data-tour": "si-paste-box" }} />
          {parsed && (
            <Box sx={{ mt: 2 }} data-tour="si-paste-preview">
              <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>{t("previewTitle", { rows: String(preview.length), trucks: String(parsed.lines.length), bundles: String(preview.reduce((a, r) => a + (r.bundles ?? 0), 0)) })}</Typography>
              {parsed.problems.length > 0 && (
                <Alert severity="warning" sx={{ my: 1, "& ul": { m: 0, pl: 2 } }}>
                  <ul>{parsed.problems.slice(0, 8).map((p) => <li key={p.line}>{t(`why_${p.why}`, { line: String(p.line), text: p.text })}</li>)}</ul>
                </Alert>
              )}
              <Table size="small">
                <TableHead><TableRow sx={{ "& th": { fontWeight: 700 } }}><TableCell>{te("deliveryDate")}</TableCell><TableCell>{te("shipDate")}</TableCell><TableCell>LOT</TableCell><TableCell>{te("billet")}</TableCell><TableCell align="right">{t("trucks")}</TableCell><TableCell align="right">{te("bundles")}</TableCell><TableCell>{te("destination")}</TableCell></TableRow></TableHead>
                <TableBody>
                  {preview.map((r) => (
                    <TableRow key={`${r.deliveryDate}-${r.lot}`}>
                      <TableCell>{md(r.deliveryDate)} <Typography component="span" variant="caption" color="text.secondary">{dayLabel(r.deliveryDate)}</Typography></TableCell>
                      <TableCell>{md(r.shipDate)} <Typography component="span" variant="caption" color="text.secondary">{dayLabel(r.shipDate)}</Typography></TableCell>
                      <TableCell>{r.lot}</TableCell>
                      <TableCell sx={{ whiteSpace: "pre-line" }}>{r.billet}</TableCell>
                      <TableCell align="right">{r.trucks}</TableCell>
                      <TableCell align="right">{r.bundles}</TableCell>
                      <TableCell>{r.destination}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {(() => {
                const all = bundleTotals([...rows.filter((r) => !isEmptyRow(r)), ...preview], lots);
                const sign = (n: number) => (n > 0 ? `+${n}` : String(n));
                return lots.length ? (
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
                    <Typography variant="caption" color={all.diff === 0 ? "success.main" : "warning.main"}>{t("afterAdd", { rows: String(all.total), bl: String(all.bl), diff: sign(all.diff) })}</Typography>
                    {all.perLot.map((l) => <Typography key={l.lot} variant="caption" color={l.diff === 0 ? "success.main" : "warning.main"}>{t("lotTotal", { lot: l.lot, rows: String(l.rows), bl: String(l.bl), diff: sign(l.diff) })}</Typography>)}
                  </Stack>
                ) : null;
              })()}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPaste(null)}>{t("cancel")}</Button>
          <Button variant="contained" disabled={!preview.length} onClick={() => { addRows(preview); setPaste(null); }} data-tour="si-paste-add">{t("addRows", { n: String(preview.length) })}</Button>
        </DialogActions>
      </Dialog>

      {/* Fill days */}
      <Dialog open={!!fill} onClose={() => setFill(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t("fillTitle")}</DialogTitle>
        {fill && (
          <DialogContent dividers>
            <Stack spacing={1.5}>
              <Stack direction="row" spacing={1}>
                <TextField size="small" type="date" label={t("from")} value={fill.from} onChange={(e) => setFill({ ...fill, from: e.target.value })} InputLabelProps={{ shrink: true }} fullWidth />
                <TextField size="small" type="date" label={t("to")} value={fill.to} onChange={(e) => setFill({ ...fill, to: e.target.value })} InputLabelProps={{ shrink: true }} fullWidth />
              </Stack>
              <Stack direction="row" spacing={1}>
                <TextField size="small" type="number" label={t("bundlesPerDay")} value={fill.bundles} onChange={(e) => setFill({ ...fill, bundles: e.target.value })} fullWidth />
                {lots.length > 1 && (
                  <TextField select size="small" label="LOT" value={fill.lot} onChange={(e) => setFill({ ...fill, lot: e.target.value })} fullWidth>
                    {lots.map((l) => <MenuItem key={l.lot} value={l.lot}>{l.lot}</MenuItem>)}
                  </TextField>
                )}
              </Stack>
              <FormControlLabel control={<Checkbox size="small" checked={fill.skip} onChange={(e) => setFill({ ...fill, skip: e.target.checked })} />} label={<Typography variant="body2">{t("skip")}</Typography>} />
              <Typography variant="body2" color="text.secondary">{fillRows.length ? t("fillPreview", { n: String(fillRows.length), list: fillRows.map((r) => md(r.deliveryDate)).join(", ") }) : t("fillNone")}</Typography>
            </Stack>
          </DialogContent>
        )}
        <DialogActions>
          <Button onClick={() => setFill(null)}>{t("cancel")}</Button>
          <Button variant="contained" disabled={!fillRows.length} onClick={() => { addRows(fillRows); setFill(null); }}>{t("addRows", { n: String(fillRows.length) })}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
