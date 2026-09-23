"use client";

import React from "react";
import {
  Alert,
  Box,
  Chip,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import {
  ESS_CATEGORIES,
  ESS_FINAL_CONCLUSION,
  ESS_HEADER_FIXED,
  ESS_POWER_ON_TESTS,
  essDefectSummary,
  essItemKey,
  essRecommendations,
  isOverridden,
  type EssMeasure,
  type EssServiceData,
} from "@/lib/msr-templates";

const RESOURCE_URL =
  process.env.NEXT_PUBLIC_RESOURCE_URL ?? "https://aims-osiris.s3.ap-southeast-1.amazonaws.com/";

/**
 * SHARED ESS REPORT LAYOUT — one implementation, two screens.
 *
 * The office detail page and the field app's print/download screen must show
 * the SAME document: if a technician prints something the office then opens and
 * finds different, the report is not evidence of anything. Both live in this one
 * Next.js app (the field is the `(field)` route group), so they can literally
 * share the React — identical by construction rather than by discipline.
 *
 * The server PDF is the third renderer and CANNOT share this: it lives in the
 * API deployable, emits an HTML string for Puppeteer, and is print-only
 * black-on-white where this is themed and must work in dark mode. It stays a
 * mirror kept in step through the shared catalogue — labels, categories,
 * thresholds, and now the recommendation and conclusion TEXT — so the words can
 * never drift even though the markup is separate.
 */

/**
 * ESS report body — equipment, detailed record, defects, power-on tests.
 * Laid out as the printed report, not as portal cards.
 *
 * The office and the customer must be able to hold the screen and the emailed
 * PDF side by side and see the same document: same section order, same column
 * headings, same row numbering. So this renders bordered tables rather than the
 * label/value stacks the generic report uses.
 *
 * It renders from the STORED payload against the SHARED catalogue: labels come
 * from the catalogue, verdicts from the row. An item the row has no answer for
 * shows "—" rather than defaulting to Pass — a missing verdict is missing
 * information, not a pass.
 *
 * It is still MUI, not a copy of the PDF's HTML: colours come from theme tokens
 * so the page works in dark mode (the PDF is unconditionally black-on-white,
 * which is correct for paper and wrong for a themed screen). What the two share
 * today is the CATALOGUE — labels, categories, thresholds, the defect summary
 * line — which is where the drift that matters would otherwise happen.
 */
export function renderEssBody(ess: EssServiceData | null, nextServiceDate?: string | null) {
  if (!ess) {
    return (
      <Paper variant="outlined" sx={{ p: 3 }} className="msr-section">
        <Alert severity="warning">
          This report is marked ESS_V1 but carries no inspection data.
        </Alert>
      </Paper>
    );
  }

  // One bordered table, titled, that refuses to split across printed pages.
  const section = (title: string, body: React.ReactNode, cls = "") => (
    <Paper variant="outlined" sx={{ p: 0, overflow: "hidden" }} className={`msr-section ${cls}`}>
      <Typography
        variant="subtitle2"
        fontWeight={700}
        sx={{ px: 2, py: 1.25, bgcolor: "action.hover", borderBottom: 1, borderColor: "divider" }}
      >
        {title}
      </Typography>
      <Box sx={{ overflowX: "auto" }}>{body}</Box>
    </Paper>
  );

  const headSx = { fontWeight: 700, whiteSpace: "nowrap", bgcolor: "action.hover" } as const;
  const cellSx = { verticalAlign: "top" } as const;

  const verdictCell = (v?: string | null) =>
    v ? (
      <Chip size="small" label={v} color={v === "FAIL" || v === "NG" ? "error" : "success"} />
    ) : (
      <Typography variant="body2" color="text.disabled">—</Typography>
    );

  /**
   * The "Data / Remarks" cell: the reading bound to this row (if any), then
   * the technician's remark, falling back to the reference's own hint.
   * An override is stated as an override — showing the chosen verdict alone
   * would present a Pass on a failing reading with nothing to say a human
   * decided that.
   */
  const dataCell = (measures: EssMeasure[], itemId: number, remark?: string | null, hint?: string) => {
    const own = measures.filter((m) => m.itemId === itemId);
    const note = remark || hint;
    if (own.length === 0 && !note) return <Typography variant="body2" color="text.disabled">—</Typography>;
    return (
      <Stack spacing={0.5}>
        {own.map((m) => {
          const r = ess.measures?.[m.key];
          const overridden = isOverridden(r);
          const shown =
            m.kind === "boolean"
              ? r?.value
                ? "Yes"
                : "No"
              : r?.value === null || r?.value === undefined || r?.value === ""
                ? "—"
                : `${r.value}${m.unit ? ` ${m.unit}` : ""}`;
          return (
            <Stack key={m.key} direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
              <Typography variant="body2" color="text.secondary">{m.label}:</Typography>
              <Typography variant="body2" fontWeight={700}>{shown}</Typography>
              {m.threshold != null && (
                <Typography variant="caption" color="text.secondary">
                  (pass ≤ {m.threshold} {m.unit})
                </Typography>
              )}
              {overridden && (
                <Chip size="small" color="warning" label={`overridden — auto ${r?.suggested}`} />
              )}
              {overridden && r?.remark && (
                <Typography variant="caption" color="warning.main">{r.remark}</Typography>
              )}
            </Stack>
          );
        })}
        {note && (
          <Typography variant="body2" color={remark ? "text.primary" : "text.secondary"}>
            {note}
          </Typography>
        )}
      </Stack>
    );
  };

  return (
    <>
      {section(
        "Equipment",
        <Table size="small">
          <TableBody>
            {ESS_HEADER_FIXED.map((f) => (
              <TableRow key={f.label}>
                <TableCell sx={{ ...headSx, width: 200 }}>{f.label}</TableCell>
                <TableCell sx={cellSx}>{f.value}</TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell sx={{ ...headSx, width: 200 }}>Equipment ID</TableCell>
              <TableCell sx={cellSx}>{ess.header?.equipmentId ?? "—"}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell sx={headSx}>Site</TableCell>
              <TableCell sx={cellSx}>{ess.header?.site ?? "—"}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell sx={headSx}>Inspection Date</TableCell>
              <TableCell sx={cellSx}>{ess.header?.inspectionDate ?? "—"}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell sx={headSx}>Inspection Type</TableCell>
              <TableCell sx={cellSx}>{ess.header?.inspectionType ?? "—"}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell sx={headSx}>Rated Power</TableCell>
              <TableCell sx={cellSx}>
                {ess.header?.ratedPowerKw != null ? `${ess.header.ratedPowerKw} kW` : "—"}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell sx={headSx}>Rated Capacity</TableCell>
              <TableCell sx={cellSx}>
                {ess.header?.ratedCapacityKwh != null ? `${ess.header.ratedCapacityKwh} kWh` : "—"}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>,
      )}

      {section(
        "Detailed Record",
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ ...headSx, width: 56 }}>No.</TableCell>
              <TableCell sx={headSx}>Inspection Item</TableCell>
              <TableCell sx={{ ...headSx, width: 84 }}>Result</TableCell>
              <TableCell sx={{ ...headSx, width: "34%" }}>Data / Remarks</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {ESS_CATEGORIES.map((cat) => (
              <React.Fragment key={cat.id}>
                <TableRow className="msr-category">
                  <TableCell colSpan={4} sx={{ fontWeight: 700, bgcolor: "action.selected" }}>
                    {cat.id}. {cat.title}
                  </TableCell>
                </TableRow>
                {cat.items.map((item) => {
                  const r = ess.items?.[essItemKey(cat.id, item.id)];
                  return (
                    <TableRow key={item.id}>
                      <TableCell sx={{ ...cellSx, color: "text.secondary" }}>
                        {cat.id}.{item.id}
                      </TableCell>
                      <TableCell sx={cellSx}>{item.label}</TableCell>
                      <TableCell sx={cellSx}>{verdictCell(r?.verdict)}</TableCell>
                      <TableCell sx={cellSx}>
                        {dataCell(cat.measures ?? [], item.id, r?.remark, item.hint)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </React.Fragment>
            ))}
          </TableBody>
        </Table>,
      )}

      {section(
        "Defect Tracking",
        <>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ ...headSx, width: 56 }}>No.</TableCell>
                <TableCell sx={headSx}>Description</TableCell>
                <TableCell sx={{ ...headSx, width: 96 }}>Risk Level</TableCell>
                <TableCell sx={headSx}>Corrective Action</TableCell>
                <TableCell sx={{ ...headSx, width: 110 }}>Status</TableCell>
                <TableCell sx={{ ...headSx, width: 170 }}>Photos</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(ess.defects ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6}>
                    <Typography variant="body2" color="text.secondary">
                      No defects recorded.
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                ess.defects.map((d, i) => (
                  <TableRow key={i}>
                    <TableCell sx={{ ...cellSx, color: "text.secondary" }}>{i + 1}</TableCell>
                    <TableCell sx={cellSx}>{d.description || "—"}</TableCell>
                    <TableCell sx={cellSx}>
                      <Chip
                        size="small"
                        label={d.riskLevel}
                        color={d.riskLevel === "Major" ? "error" : "warning"}
                      />
                    </TableCell>
                    <TableCell sx={cellSx}>{d.correctiveAction || "—"}</TableCell>
                    <TableCell sx={cellSx}>
                      <Chip size="small" label={d.status} variant="outlined" />
                    </TableCell>
                    <TableCell sx={cellSx}>
                      {(d.photos ?? []).length === 0 ? (
                        <Typography variant="body2" color="text.disabled">—</Typography>
                      ) : (
                        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                          {(d.photos ?? []).map((key) => (
                            <a
                              key={key}
                              href={`${RESOURCE_URL}${key}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={`${RESOURCE_URL}${key}`}
                                alt="Defect"
                                style={{
                                  width: 48,
                                  height: 48,
                                  objectFit: "cover",
                                  borderRadius: 3,
                                  border: "1px solid rgba(128,128,128,0.4)",
                                }}
                              />
                            </a>
                          ))}
                        </Stack>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          <Typography variant="body2" fontWeight={700} sx={{ px: 2, py: 1.25 }}>
            {essDefectSummary(ess.defectTotals?.major ?? 0, ess.defectTotals?.minor ?? 0)}
          </Typography>
        </>,
        "msr-defects",
      )}

      {section(
        "Power-on Tests",
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ ...headSx, width: 56 }}>No.</TableCell>
              <TableCell sx={headSx}>Test Item</TableCell>
              <TableCell sx={{ ...headSx, width: 84 }}>Result</TableCell>
              <TableCell sx={{ ...headSx, width: "34%" }}>Remarks</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {ESS_POWER_ON_TESTS.map((t) => {
              const r = ess.powerOn?.[String(t.id)];
              const note = r?.remark || t.hint;
              return (
                <TableRow key={t.id}>
                  <TableCell sx={{ ...cellSx, color: "text.secondary" }}>{t.id}</TableCell>
                  <TableCell sx={cellSx}>{t.label}</TableCell>
                  <TableCell sx={cellSx}>{verdictCell(r?.verdict)}</TableCell>
                  <TableCell sx={cellSx}>
                    {note ? (
                      <Typography variant="body2" color={r?.remark ? "text.primary" : "text.secondary"}>
                        {note}
                      </Typography>
                    ) : (
                      <Typography variant="body2" color="text.disabled">—</Typography>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>,
        "msr-poweron",
      )}

      {/* The reference's two standing sections. PRINTED, NEVER CAPTURED — the
          field form does not ask for them and must not: they are advice about
          the class of equipment and the statement the report is issued under,
          not observations from this visit. They sit here because that is where
          the reference puts them: after the power-on tests, before signing. */}
      {section(
        "Operation & Maintenance Recommendations",
        <Box component="ol" sx={{ pl: 4, pr: 2, py: 1.5, m: 0 }}>
          {essRecommendations(nextServiceDate).map((r, i) => (
            <Typography component="li" variant="body2" key={i} sx={{ mb: 0.75 }}>
              {r}
            </Typography>
          ))}
        </Box>,
      )}

      {section(
        "Final Inspection Conclusion",
        <Box sx={{ px: 2, py: 1.5 }}>
          {ESS_FINAL_CONCLUSION.map((para, i) => (
            <Typography variant="body2" key={i} sx={{ mb: i === 0 ? 1 : 0 }}>
              {para}
            </Typography>
          ))}
        </Box>,
      )}
    </>
  );
}

/**
 * Pre-inspection Status + Overall Conclusion — rendered immediately above the
 * signature block, matching `buildEssConclusionHtml` in the PDF builder. Kept
 * separate from the body for exactly that reason: the generic Remarks/Times
 * card sits between the two, in both renderers.
 */
export function renderEssConclusion(ess: EssServiceData | null) {
  if (!ess) return null;
  const headSx = { fontWeight: 700, whiteSpace: "nowrap", bgcolor: "action.hover" } as const;
  return (
    <Paper variant="outlined" sx={{ p: 0, overflow: "hidden" }} className="msr-section">
      <Typography
        variant="subtitle2"
        fontWeight={700}
        sx={{ px: 2, py: 1.25, bgcolor: "action.hover", borderBottom: 1, borderColor: "divider" }}
      >
        Conclusion
      </Typography>
      <Table size="small">
        <TableBody>
          <TableRow>
            <TableCell sx={{ ...headSx, width: 220 }}>Pre-inspection Status</TableCell>
            <TableCell>{ess.summary?.preStatus ?? "—"}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell sx={headSx}>Overall Conclusion</TableCell>
            <TableCell>{ess.summary?.conclusion ?? "—"}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Paper>
  );
}


export function FieldLabel({ label, value }: { label: string; value?: string | null }) {
  return (
    <Box sx={{ mb: 1.5 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
        {label}
      </Typography>
      <Typography variant="body2" fontWeight={500}>
        {value ?? "—"}
      </Typography>
    </Box>
  );
}

export function SignatureBlock({ url, name }: { url: string | null; name: string }) {
  return (
    <Box
      sx={{
        mt: 0.5,
        p: 1.5,
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 1,
        bgcolor: "background.paper",
        minHeight: 140,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
      }}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={`Signature of ${name}`}
          style={{ maxWidth: "100%", maxHeight: 100, objectFit: "contain" }}
        />
      ) : (
        <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Typography variant="caption" color="text.disabled">No signature on file</Typography>
        </Box>
      )}
      <Typography variant="body2" fontWeight={500} sx={{ mt: 1, pt: 1, borderTop: "1px dashed", borderColor: "divider" }}>
        {name}
      </Typography>
    </Box>
  );
}
