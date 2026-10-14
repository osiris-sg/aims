"use client";

// Customer PL / Customer COA form: header (letterhead, To, date, reference
// lines to tick on/off, COA spec line, pieces, remarks — or, for ADH's
// Japanese layout, the 計量検収票 / 納品書兼分析試験成績報告書 fields), column
// toggles, and the editable rows with live totals. Rows use native inputs: a COA is ~120
// rows × ~20 columns, and 2,000+ MUI inputs froze the page.

import React, { useMemo } from "react";
import { Box, Button, Checkbox, Divider, FormControlLabel, Grid2, IconButton, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Tooltip, Typography } from "@mui/material";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import AddIcon from "@mui/icons-material/Add";
import type { GenColumn, GenHeader, GenRow } from "@/app/portal/shipments/_lib/api";
import { fmtMt } from "@/app/portal/shipments/_lib/format";
import type { DocFormProps } from "./types";
import { guardDate } from "@/app/portal/shipments/_lib/dates";

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const toNum = (v: unknown) => (v === "" || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));

export default function TableDocForm({ doc: g, header, rows, columns, disabled: isFinal, setHeader: setH, setRows, setColumns }: DocFormProps<GenHeader, GenRow>) {
  const visible = (columns as GenColumn[]).filter((c) => c.visible);
  const totals = useMemo(() => {
    const sumKey = (k: string) => round3(rows.reduce((s, r) => s + (Number(r[k]) || 0), 0));
    const mtCols = (columns as GenColumn[]).filter((c) => c.kind === "mt");
    return { bundles: rows.length, mt: Object.fromEntries(mtCols.map((c) => [c.key, sumKey(c.key)])) as Record<string, number> };
  }, [rows, columns]);
  const edit = (fn: () => void) => {
    if (!isFinal) fn();
  };
  const setCell = (i: number, c: GenColumn, v: string) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [c.key]: c.kind === "mt" || c.kind === "number" ? toNum(v) : v === "" ? null : v } : r)));
  const addRow = () => setRows((rs) => [...rs, Object.fromEntries((columns as GenColumn[]).map((c) => [c.key, c.key === "no" ? rs.length + 1 : null])) as GenRow]);
  const removeRow = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i).map((r, j) => ("no" in r ? { ...r, no: j + 1 } : r)));

  const jp = header.layout === "jp";
  type JpText = "formLabel" | "date" | "title" | "toSuffix" | "invoiceNo" | "plDate" | "portOfDischarge" | "goodsDescription" | "origin" | "hsCode" | "applicant" | "productLine" | "sizeLine" | "weightUnit" | "analysisDate" | "vendor";
  const jtf = (k: JpText, label: string, extra: Record<string, unknown> = {}) => (
    <TextField size="small" fullWidth label={label} value={header[k] ?? ""} disabled={isFinal} onChange={(e) => setH({ [k]: e.target.value })} {...guardDate(extra, header[k])} />
  );
  const jnf = (k: "bundles" | "piecesPerBundle", label: string, extra: Record<string, unknown> = {}) => (
    <TextField size="small" fullWidth type="number" label={label} value={header[k] ?? ""} disabled={isFinal} onChange={(e) => setH({ [k]: toNum(e.target.value) })} {...extra} />
  );
  const issuer = header.issuer ?? { name: "", address: "", contact: "" };
  const rowBundles = rows.reduce((a, r) => a + (Number(r.bundles) || 0), 0);

  return (
    <>
          {jp ? (
          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
              {g.docType === "CUSTOMER_COA" ? "納品書兼分析試験成績報告書" : "計量検収票"}
            </Typography>
            <Grid2 container spacing={1.5}>
              <Grid2 size={{ xs: 6, sm: 3 }}>{jtf("formLabel", "様式")}</Grid2>
              <Grid2 size={{ xs: 6, sm: 3 }}>{jtf("date", "Date", { type: "date", InputLabelProps: { shrink: true } })}</Grid2>
              <Grid2 size={{ xs: 12, sm: 6 }}>{jtf("title", "Title")}</Grid2>
              <Grid2 size={{ xs: 12, sm: 9 }}>
                <TextField size="small" fullWidth label="宛先 (customer)" value={header.to.name} onChange={(e) => setH({ to: { ...header.to, name: e.target.value } })} disabled={isFinal} />
              </Grid2>
              <Grid2 size={{ xs: 12, sm: 3 }}>{jtf("toSuffix", "Suffix")}</Grid2>
              <Grid2 size={12}>
                <TextField size="small" fullWidth multiline label="宛先 address" value={header.to.address ?? ""} onChange={(e) => setH({ to: { ...header.to, address: e.target.value } })} disabled={isFinal} />
              </Grid2>
              <Grid2 size={{ xs: 12, sm: 4 }}>
                <TextField size="small" fullWidth label="Issuer" value={issuer.name} onChange={(e) => setH({ issuer: { ...issuer, name: e.target.value } })} disabled={isFinal} />
              </Grid2>
              <Grid2 size={{ xs: 12, sm: 5 }}>
                <TextField size="small" fullWidth multiline label="Issuer address" value={issuer.address} onChange={(e) => setH({ issuer: { ...issuer, address: e.target.value } })} disabled={isFinal} />
              </Grid2>
              <Grid2 size={{ xs: 12, sm: 3 }}>
                <TextField size="small" fullWidth label="担当" value={issuer.contact} onChange={(e) => setH({ issuer: { ...issuer, contact: e.target.value } })} disabled={isFinal} />
              </Grid2>
              {g.docType === "CUSTOMER_COA" ? (
                <>
                  <Grid2 size={{ xs: 12, sm: 6 }}>{jtf("productLine", "品種 (e.g. ALUMINIUM BILLET 6005)")}</Grid2>
                  <Grid2 size={{ xs: 12, sm: 6 }}>{jtf("sizeLine", "Size (e.g. 203MM × 5800MM)")}</Grid2>
                  <Grid2 size={{ xs: 6, sm: 3 }}>{jnf("bundles", "バンドル数", { placeholder: String(rowBundles), InputLabelProps: { shrink: true }, helperText: "Blank = rows' total" })}</Grid2>
                  <Grid2 size={{ xs: 6, sm: 3 }}>{jnf("piecesPerBundle", "1BD本数")}</Grid2>
                  <Grid2 size={{ xs: 6, sm: 3 }}>{jtf("weightUnit", "Weight unit")}</Grid2>
                  <Grid2 size={{ xs: 6, sm: 3 }}>{jtf("analysisDate", "分析 日付", {
                    type: "date",
                    required: true,
                    InputLabelProps: { shrink: true },
                    // Never defaulted to today: from the source / a Vedanta COA PDF, else typed.
                    ...(!isFinal && !String(header.analysisDate ?? "").trim() ? { error: true, helperText: "Required before Finalize — the source file has no date" } : {}),
                  })}</Grid2>
                  <Grid2 size={{ xs: 12, sm: 6 }}>{jtf("vendor", "ベンダー")}</Grid2>
                </>
              ) : (
                <>
                  <Grid2 size={{ xs: 12, sm: 6 }}>{jtf("invoiceNo", "INVOICE NO (Vedanta CI no.)")}</Grid2>
                  <Grid2 size={{ xs: 12, sm: 6 }}>{jtf("plDate", "DATE (Vedanta PL)", { type: "date", InputLabelProps: { shrink: true } })}</Grid2>
                  <Grid2 size={{ xs: 12, sm: 6 }}>{jtf("portOfDischarge", "Port of Discharge")}</Grid2>
                  <Grid2 size={{ xs: 12, sm: 6 }}>{jtf("goodsDescription", "Goods Description")}</Grid2>
                  <Grid2 size={{ xs: 6, sm: 6 }}>{jtf("origin", "Country of Origin")}</Grid2>
                  <Grid2 size={{ xs: 6, sm: 6 }}>{jtf("hsCode", "HS CODE")}</Grid2>
                  <Grid2 size={12}>{jtf("applicant", "Applicant", { multiline: true, minRows: 2 })}</Grid2>
                </>
              )}
            </Grid2>
          </Paper>
          ) : (
          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
              Header
            </Typography>
            <Grid2 container spacing={1.5}>
              <Grid2 size={{ xs: 12, sm: 6 }}>
                <TextField size="small" fullWidth label="Title" value={header.title} onChange={(e) => setH({ title: e.target.value })} disabled={isFinal} />
              </Grid2>
              <Grid2 size={{ xs: 12, sm: 6 }}>
                <TextField size="small" fullWidth label="Date" InputLabelProps={{ shrink: true }} value={header.date} onChange={(e) => setH({ date: e.target.value })} disabled={isFinal} {...guardDate({ type: "date" }, header.date)} />
              </Grid2>
              <Grid2 size={{ xs: 12, sm: 6 }}>
                <TextField size="small" fullWidth label="Letterhead — name" value={header.letterhead.name} onChange={(e) => setH({ letterhead: { ...header.letterhead, name: e.target.value } })} disabled={isFinal} />
              </Grid2>
              <Grid2 size={{ xs: 12, sm: 6 }}>
                <TextField size="small" fullWidth label="Letterhead — phone" value={header.letterhead.phone ?? ""} onChange={(e) => setH({ letterhead: { ...header.letterhead, phone: e.target.value } })} disabled={isFinal} />
              </Grid2>
              <Grid2 size={{ xs: 12, sm: 8 }}>
                <TextField size="small" fullWidth label="Letterhead — address" value={header.letterhead.address ?? ""} onChange={(e) => setH({ letterhead: { ...header.letterhead, address: e.target.value } })} disabled={isFinal} />
              </Grid2>
              <Grid2 size={{ xs: 12, sm: 4 }}>
                <TextField size="small" fullWidth label="Registration no." value={header.letterhead.registrationNo ?? ""} onChange={(e) => setH({ letterhead: { ...header.letterhead, registrationNo: e.target.value } })} disabled={isFinal} />
              </Grid2>
              <Grid2 size={{ xs: 12, sm: 6 }}>
                <TextField size="small" fullWidth label="To" value={header.to.name} onChange={(e) => setH({ to: { ...header.to, name: e.target.value } })} disabled={isFinal} />
              </Grid2>
              <Grid2 size={{ xs: 12, sm: 6 }}>
                <TextField size="small" fullWidth label="To — address" value={header.to.address ?? ""} onChange={(e) => setH({ to: { ...header.to, address: e.target.value } })} disabled={isFinal} />
              </Grid2>
              {g.docType === "CUSTOMER_COA" && (
                <Grid2 size={{ xs: 12, sm: 8 }}>
                  <TextField size="small" fullWidth label="Spec line (grade, size)" value={header.spec ?? ""} onChange={(e) => setH({ spec: e.target.value })} disabled={isFinal} />
                </Grid2>
              )}
              <Grid2 size={{ xs: 12, sm: 4 }}>
                <TextField size="small" fullWidth type="number" label="Pieces" value={header.pieces ?? ""} onChange={(e) => setH({ pieces: toNum(e.target.value) })} disabled={isFinal} />
              </Grid2>
              <Grid2 size={12}>
                <TextField size="small" fullWidth multiline minRows={2} label="Remarks" value={header.remarks ?? ""} onChange={(e) => setH({ remarks: e.target.value })} disabled={isFinal} />
              </Grid2>
            </Grid2>
            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              References
            </Typography>
            <Stack spacing={0.75}>
              {header.refs.map((r, i) => (
                <Stack key={r.key} direction="row" spacing={1} alignItems="center">
                  <Checkbox
                    size="small"
                    checked={r.visible}
                    disabled={isFinal}
                    onChange={(e) => setH({ refs: header.refs.map((x, j) => (j === i ? { ...x, visible: e.target.checked } : x)) })}
                    inputProps={{ "aria-label": `Print ${r.label}` }}
                  />
                  <Typography variant="body2" sx={{ width: 190, flexShrink: 0, color: "text.secondary" }}>
                    {r.label}
                  </Typography>
                  <TextField size="small" fullWidth value={r.value} disabled={isFinal} onChange={(e) => setH({ refs: header.refs.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} />
                </Stack>
              ))}
            </Stack>
          </Paper>
          )}

          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
              <Typography variant="subtitle2">Rows</Typography>
              <Box sx={{ flex: 1 }} />
              <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: "tabular-nums" }}>
                Bundles {totals.bundles}
                {Object.entries(totals.mt).map(([k, v]) => ` · ${columns.find((c) => c.key === k)?.label ?? k} ${fmtMt(v)}`)}
              </Typography>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              Columns
            </Typography>
            <Stack direction="row" flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
              {columns.map((c, i) => (
                <FormControlLabel
                  key={c.key}
                  sx={{ mr: 1.5 }}
                  control={<Checkbox size="small" checked={c.visible} disabled={isFinal} onChange={(e) => edit(() => setColumns((cs: GenColumn[]) => cs.map((x, j) => (j === i ? { ...x, visible: e.target.checked } : x))))} />}
                  label={<Typography variant="body2">{c.label}</Typography>}
                />
              ))}
            </Stack>
            <Box
              sx={{
                overflowX: "auto",
                maxHeight: 520,
                overflowY: "auto",
                border: 1,
                borderColor: "divider",
                borderRadius: 1,
                // Theme-aware native cell inputs (light + dark).
                "& .gen-cell": { width: "100%", font: "inherit", fontSize: 13, color: "text.primary", bgcolor: "transparent", border: "1px solid transparent", borderRadius: 0.5, px: 0.5, py: 0.25 },
                "& .gen-cell:hover:not(:disabled)": { borderColor: "divider" },
                "& .gen-cell:focus": { outline: "none", borderColor: "primary.main", bgcolor: "action.hover" },
                "& .gen-cell:disabled": { color: "text.secondary" },
              }}
            >
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    {visible.map((c) => (
                      <TableCell key={c.key} sx={{ whiteSpace: "nowrap", fontWeight: 700 }} align={c.kind === "mt" || c.kind === "number" ? "right" : "left"}>
                        {c.label}
                      </TableCell>
                    ))}
                    <TableCell />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((r, i) => (
                    <TableRow key={i} hover>
                      {visible.map((c) => (
                        <TableCell key={c.key} sx={{ p: 0.25 }}>
                          {/* Native input, not TextField: a COA is ~120 rows × ~20
                              columns, and 2,000+ MUI inputs froze the page. */}
                          <Box
                            component="input"
                            className="gen-cell"
                            value={r[c.key] ?? ""}
                            disabled={isFinal}
                            type={c.kind === "mt" || c.kind === "number" ? "number" : "text"}
                            step={c.kind === "mt" ? "0.001" : undefined}
                            aria-label={`${c.label} row ${i + 1}`}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCell(i, c, e.target.value)}
                            sx={{ textAlign: c.kind === "mt" || c.kind === "number" ? "right" : "left", minWidth: c.kind === "mt" ? 70 : 60 }}
                          />
                        </TableCell>
                      ))}
                      <TableCell sx={{ p: 0.25 }}>
                        <Tooltip title="Remove row">
                          <span>
                            <IconButton size="small" aria-label="Remove row" onClick={() => removeRow(i)} disabled={isFinal}>
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    {visible.map((c, j) => (
                      <TableCell key={c.key} align={c.kind === "mt" ? "right" : "left"} sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                        {c.kind === "mt" ? fmtMt(totals.mt[c.key]) : j === 0 ? "Total" : ""}
                      </TableCell>
                    ))}
                    <TableCell />
                  </TableRow>
                </TableBody>
              </Table>
            </Box>
            {!isFinal && (
              <Button size="small" startIcon={<AddIcon />} onClick={addRow} sx={{ mt: 1 }}>
                Add row
              </Button>
            )}
          </Paper>
    </>
  );
}
