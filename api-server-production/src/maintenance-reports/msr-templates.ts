/**
 * MAINTENANCE SERVICE REPORT — TEMPLATE CATALOGUE (backend MIRROR).
 *
 * ─── DRIFT WARNING — THIS FILE IS A COPY ─────────────────────────────────────
 * The CANONICAL copy lives in the other deployable:
 *
 *     portal-production/lib/msr-templates.ts
 *
 * Edit that one first, then mirror the change here verbatim. The two are a
 * plain `diff` apart: everything below this docblock is identical, so
 *
 *     diff <(tail -n +34 portal-production/lib/msr-templates.ts) \
 *          <(tail -n +28 api-server-production/src/maintenance-reports/msr-templates.ts)
 *
 * should be empty (line offsets = each file's docblock length). If a label, item id, category or threshold differs, the
 * emailed PDF will disagree with what the office and the field tech saw.
 *
 * It is duplicated rather than imported because the portal and the API are
 * separate deployables with no shared package; the previous arrangement had
 * the same labels hand-synced across THREE files with nothing saying so.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Consumed here by `service-report-pdf.ts` only. See the canonical file for
 * the full contract: templates are resolved ONCE at capture time and stamped
 * into `serviceData.templateId`; renderers read the stamped id and never the
 * asset, and a missing id means GENERIC_V1.
 */

export type MsrTemplateId = 'GENERIC_V1' | 'ESS_V1' | 'WCT_V1';

/** Per-item verdict on the ESS detailed record. */
export type EssVerdict = 'PASS' | 'FAIL';
/** Per-item verdict on the ESS power-on tests (the reference uses OK/NG). */
export type PowerOnVerdict = 'OK' | 'NG';

// ─────────────────────────────────────────────────────────────────────────────
// GENERIC_V1 — today's 30-item form, byte for byte.
//
// Items 26–30 are reserved blanks on the paper form; they are preserved so the
// rendered grid matches the printed original row for row. The ids are the
// persisted contract: `serviceData.checklist` is a sorted array of TICKED ids
// only, so an id may never be renumbered or reused.
// ─────────────────────────────────────────────────────────────────────────────

export interface GenericChecklistItem {
  id: number;
  label: string;
}

export const GENERIC_CHECKLIST: GenericChecklistItem[] = [
  { id: 1, label: 'Control panel' },
  { id: 2, label: 'PLC' },
  { id: 3, label: 'HMI' },
  { id: 4, label: 'Power voltage' },
  { id: 5, label: 'Frequency' },
  { id: 6, label: 'Backwash pump' },
  { id: 7, label: 'Submersible pump' },
  { id: 8, label: 'Aerator' },
  { id: 9, label: 'Suction pump' },
  { id: 10, label: 'Air scouring pump' },
  { id: 11, label: 'Turbula pump' },
  { id: 12, label: '3 way valve' },
  { id: 13, label: '1 way valve' },
  { id: 14, label: 'Backwash valve' },
  { id: 15, label: 'Discharge valve' },
  { id: 16, label: 'X-flow valve' },
  { id: 17, label: 'Product valve' },
  { id: 18, label: 'Pump relief valve' },
  { id: 19, label: 'Holding tank level sensor' },
  { id: 20, label: 'MBR tank level sensor' },
  { id: 21, label: 'Product tank level sensor' },
  { id: 22, label: 'Filtration pressure' },
  { id: 23, label: 'Backwash pressure' },
  { id: 24, label: 'Electric wire' },
  { id: 25, label: 'Flow rate' },
  { id: 26, label: '' },
  { id: 27, label: '' },
  { id: 28, label: '' },
  { id: 29, label: '' },
  { id: 30, label: '' },
];

// ─────────────────────────────────────────────────────────────────────────────
// ESS_V1 — air-cooled energy-storage inspection report.
//
// All wording below is the REFERENCE DOCUMENT'S VERBATIM TEXT. Do not
// paraphrase it: the report is issued against GB/T 42315-2023 and the OEM O&M
// manual, and the sub-item wording is what the inspection is certifying.
// ─────────────────────────────────────────────────────────────────────────────

/** Fixed header text — printed on every ESS report, never captured. */
export const ESS_HEADER_FIXED: { label: string; value: string }[] = [
  { label: 'Equipment', value: 'Air-cooled energy storage system' },
  { label: 'Cooling Method', value: 'Forced air cooling' },
  {
    label: 'System Composition',
    value: 'Battery racks, BMS, PCS, air-cooling system, HV/LV distribution, fire monitoring, EMS',
  },
  {
    label: 'Standards Referenced',
    value: 'GB/T 42315-2023, OEM O&M manual, site safety regulations',
  },
];

/**
 * A reading, confirmation or choice attached to a sub-item.
 *
 * `compare: 'lte'` means the reading PASSES at or below `threshold` — both
 * thresholds in the reference are upper bounds (ground resistance ≤ 4 Ω, rack
 * temperature spread ≤ 10 °C). Measures with no threshold are recorded only
 * and produce no suggested verdict.
 *
 * `itemId` binds the measure to the sub-item it belongs to, so every renderer
 * shows it on that row rather than in a detached block — which is how the
 * reference lays it out.
 */
export interface EssMeasure {
  key: string;
  label: string;
  unit: string;
  /** Present => the form computes a suggested verdict from the value. */
  threshold?: number;
  compare?: 'lte';
  /** number = reading; boolean = done/not-done; choice = one of `options`. */
  kind: 'number' | 'boolean' | 'choice';
  options?: readonly string[];
  /** Sub-item this measure sits on, within its own category. */
  itemId?: number;
}

export interface EssCategory {
  /** 1–8. Stable: it is half of every item key (`"3.2"`). */
  id: number;
  title: string;
  /** Sub-items, each Pass/Fail with an optional remark. */
  items: { id: number; label: string; hint?: string }[];
  /** Readings and confirmations attached to this category's items. */
  measures?: EssMeasure[];
}

/**
 * The eight categories of the detailed record — 4,1,5,8,7,3,5,2 = 35 items.
 *
 * `hint` is the reference's parenthetical guidance for that row; renderers show
 * it in the remarks column.
 */
export const ESS_CATEGORIES: EssCategory[] = [
  {
    id: 1,
    title: 'Cabinet Structure & Sealing',
    items: [
      { id: 1, label: 'No deformation, rust, cracks, or paint peeling' },
      { id: 2, label: 'Doors, locks, sealing strips intact' },
      { id: 3, label: 'E-stop buttons and safety interlocking devices are reliable' },
      { id: 4, label: 'No moisture, condensation, debris, or odor inside' },
    ],
  },
  {
    id: 2,
    title: 'Grounding System',
    items: [
      { id: 1, label: 'Ground connections secure, no looseness/corrosion (≤4 Ω acceptable)' },
    ],
    measures: [
      {
        key: 'groundResistance',
        label: 'Ground resistance',
        unit: 'Ω',
        threshold: 4,
        compare: 'lte',
        kind: 'number',
        itemId: 1,
      },
    ],
  },
  {
    id: 3,
    title: 'Air-Cooling (Fans)',
    items: [
      { id: 1, label: 'Intake/exhaust filters clean, no blockage/damage' },
      { id: 2, label: 'Air ducts and guides intact, no leakage or dead zones' },
      { id: 3, label: 'Cooling fans visually intact, wiring secured' },
      { id: 4, label: 'Fan start/stop and speed regulation normal, no abnormal noise or jamming' },
      { id: 5, label: 'Temperature control linkage normal, automatic speed adjustment at high/low temps' },
    ],
    measures: [
      {
        key: 'fanFilterAction',
        label: 'Filters',
        unit: '',
        kind: 'choice',
        options: ['Cleaned', 'Replaced'],
        itemId: 1,
      },
      { key: 'faultyFanCount', label: 'Faulty fans', unit: 'pcs', kind: 'number', itemId: 3 },
    ],
  },
  {
    id: 4,
    title: 'Air-Cooling (AC Units)',
    items: [
      { id: 1, label: 'Housing intact, no deformation/rust/damage', hint: 'Mounting brackets secure' },
      { id: 2, label: 'Terminals no aging, arcing, or loose connections', hint: 'Cables intact' },
      { id: 3, label: 'Intake/exhaust filters free of dust, blockage, or damage' },
      { id: 4, label: 'Condensate drain clear, no blockage/pooling/backflow', hint: 'No residual condensate' },
      {
        id: 5,
        label: 'AC local control panel and backend communication normal, no interruption',
        hint: 'Remote commands executable',
      },
      { id: 6, label: 'Cooling mode starts/stops normally' },
      {
        id: 7,
        label: 'Fan running, no abnormal noise, vibration, or unusual sound',
        hint: 'Speed regulation OK',
      },
      { id: 8, label: 'Set temperature' },
    ],
    measures: [
      {
        key: 'acFilterAction',
        label: 'Filters',
        unit: '',
        kind: 'choice',
        options: ['Cleaned', 'Replaced'],
        itemId: 3,
      },
      { key: 'setTemperature', label: 'Set temperature', unit: '°C', kind: 'number', itemId: 8 },
    ],
  },
  {
    id: 5,
    title: 'Battery Racks & Modules',
    items: [
      { id: 1, label: 'Battery modules free of swelling, leakage, burn marks, or deformation' },
      { id: 2, label: 'HV busbars & cables – no overheating, oxidation, looseness' },
      { id: 3, label: 'Max temperature difference across rack ≤10 °C' },
      { id: 4, label: 'Cell voltage acquisition normal' },
      { id: 5, label: 'Temperature sensing normal, no hotspots' },
      { id: 6, label: 'Balancing function operational', hint: 'No persistent imbalance alarms' },
      { id: 7, label: 'Overall health' },
    ],
    measures: [
      { key: 'torqueCheckDone', label: 'Torque check done', unit: '', kind: 'boolean', itemId: 2 },
      {
        key: 'maxTempDiff',
        label: 'Measured ΔT',
        unit: '°C',
        threshold: 10,
        compare: 'lte',
        kind: 'number',
        itemId: 3,
      },
      { key: 'maxCellVoltageDiff', label: 'Max cell voltage diff', unit: 'mV', kind: 'number', itemId: 4 },
      { key: 'averageSoh', label: 'Average SOH', unit: '%', kind: 'number', itemId: 7 },
    ],
  },
  {
    id: 6,
    title: 'BMS',
    items: [
      { id: 1, label: 'BMS-EMS communication stable' },
      {
        id: 2,
        label: 'Overvoltage, undervoltage, overcurrent, overtemperature protection setpoints correct',
      },
      { id: 3, label: 'Firmware stable, no restarts or errors' },
    ],
  },
  {
    id: 7,
    title: 'PCS & Electrical',
    items: [
      { id: 1, label: 'PCS interior clean; capacitors/reactors no bulging/leakage' },
      { id: 2, label: 'Charge/discharge, power limiting, anti-reverse functions normal' },
      { id: 3, label: 'Over/under voltage, overcurrent, islanding protection tests normal' },
      { id: 4, label: 'Breakers, contactors, fuses, surge protectors intact' },
      { id: 5, label: 'Device communications normal' },
    ],
  },
  {
    id: 8,
    title: 'Fire Monitoring',
    items: [
      { id: 1, label: 'Smoke/heat/gas detectors no fault alarms' },
      { id: 2, label: 'Fire suppression devices intact, pressure normal, no obstruction' },
    ],
  },
];

/** The reference's four power-on tests — recorded OK / NG with a remark. */
export const ESS_POWER_ON_TESTS: { id: number; label: string; hint?: string }[] = [
  {
    id: 1,
    label: 'Air-cooling auto start/stop & speed regulation functional',
    hint: 'Temperature logic verified',
  },
  {
    id: 2,
    label: 'Low-power charge/discharge for 30 min – stable operation',
    hint: 'Voltage, current, temperature stable',
  },
  { id: 3, label: 'No new fault alarms on BMS, PCS, EMS backend' },
  { id: 4, label: 'All electrical protection and interlock functions reliable' },
];

export const ESS_INSPECTION_TYPES = ['Quarterly', 'Semi-annual', 'Annual', 'Fault-specific'] as const;

export const ESS_PRE_STATUSES = [
  'Normal operation',
  'Historical alarms',
  'Shutdown for inspection',
] as const;

export const ESS_CONCLUSIONS = [
  'Normal and ready',
  'Minor defects scheduled',
  'Major defects — do not operate',
] as const;

export const ESS_RISK_LEVELS = ['Major', 'Minor'] as const;

export const ESS_DEFECT_STATUSES = ['Open', 'In progress', 'Closed'] as const;

/**
 * OPERATION & MAINTENANCE RECOMMENDATIONS — the reference's fixed paragraphs.
 * PRINTED, NEVER CAPTURED: the field form does not ask for these and must not,
 * because they are standing advice about the class of equipment, not an
 * observation about this visit.
 *
 * The reference's fifth item was "Next scheduled maintenance date: …". It is
 * dropped: the report already states Next Service Date in its header, and
 * repeating it here gave two places to read the same fact — which is how they
 * come to disagree. Nothing takes a date any more, so this is a constant.
 */
export const ESS_RECOMMENDATIONS: string[] = [
  'Air-cooled energy storage systems are highly sensitive to dust accumulation. It is recommended to inspect and clean air filters every 1–3 months and replace filters every 6 to 12 months, so as to prevent battery overheating and excessive temperature differential caused by blocked air ducts.',
  'Regularly inspect the operating condition of cooling fans. Conduct aging assessment after 2 years of operation and replace degraded fans in advance to mitigate the risk of cooling system failure.',
  'During plum rain and high-humidity seasons, prioritize inspection of the cabinet enclosure sealing performance to prevent internal condensation, which may lead to reduced insulation capacity and electrical faults.',
  'Export background operation logs monthly, and continuously monitor battery voltage differential, cluster temperature differential and equipment alarm trends to enable proactive risk identification and preventive maintenance.',
];

/**
 * FINAL INSPECTION CONCLUSION — the reference's fixed closing paragraphs.
 * Printed, never captured, for the same reason as the recommendations: it is
 * the standing statement the report is issued under, not a free-text field.
 */
export const ESS_FINAL_CONCLUSION: string[] = [
  'A comprehensive inspection was performed covering enclosure structure, air-cooling system, battery racks, BMS, PCS, HV/LV distribution, fire monitoring, and grounding – including cleaning, terminal tightening, parameter verification, defect check, and functional power-on validation.',
  'All parameters, cooling performance, protection logic, and charge/discharge functions meet standard requirements. The system is in good overall health and is cleared for grid connection and normal operation.',
];

/** The reference's one-line defect summary. Counts are always derived. */
export function essDefectSummary(major: number, minor: number): string {
  return `Total issues found: ${major + minor} (Major: ${major}, Minor: ${minor}). All rectified and closed.`;
}

export type EssInspectionType = (typeof ESS_INSPECTION_TYPES)[number];
export type EssPreStatus = (typeof ESS_PRE_STATUSES)[number];
export type EssConclusion = (typeof ESS_CONCLUSIONS)[number];
export type EssRiskLevel = (typeof ESS_RISK_LEVELS)[number];
export type EssDefectStatus = (typeof ESS_DEFECT_STATUSES)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Stored shapes — what a renderer can expect to find in serviceData.
// ─────────────────────────────────────────────────────────────────────────────

/** One sub-item of the detailed record. Keyed `"<category>.<item>"`. */
export interface EssItemResult {
  verdict: EssVerdict;
  remark?: string | null;
}

/**
 * One measured reading.
 *
 * BOTH verdicts are stored deliberately. `suggested` is what the threshold
 * computed; `verdict` is what the technician accepted or overrode it to. A
 * renderer that shows only `verdict` would silently present a Pass on a 6 Ω
 * reading — so every renderer compares the two and marks a difference. A
 * remark is REQUIRED when they differ (enforced at capture).
 */
export interface EssMeasureResult {
  value: number | boolean | string | null;
  unit: string;
  threshold?: number | null;
  suggested?: EssVerdict | null;
  verdict?: EssVerdict | null;
  remark?: string | null;
}

export interface EssDefectRow {
  description: string;
  riskLevel: EssRiskLevel | string;
  correctiveAction: string;
  status: EssDefectStatus | string;
  /**
   * S3 keys of photos evidencing THIS defect, uploaded through the same
   * `/uploads/image` path the signatures use and stored in the same
   * `maintenance-reports` folder. Optional and absent on older rows — every
   * renderer must treat a missing array as "no photos", never as an error.
   */
  photos?: string[];
}

export interface EssPowerOnResult {
  verdict: PowerOnVerdict;
  remark?: string | null;
}

/** The ESS payload, stored at `serviceData.ess`. */
export interface EssServiceData {
  header: {
    equipmentId?: string | null;
    site?: string | null;
    inspectionDate?: string | null;
    inspectionType?: string | null;
    ratedPowerKw?: number | null;
    ratedCapacityKwh?: number | null;
  };
  /**
   * Captured LAST, on its own step immediately before the signatures — it is
   * the technician's verdict, so it is asked once the inspection has actually
   * been done rather than up front. The free-text Scope/Methods/remarks that
   * used to sit here were fixed boilerplate and are gone.
   */
  summary: {
    preStatus?: string | null;
    conclusion?: string | null;
  };
  /** `"3.2"` → result. */
  items: Record<string, EssItemResult>;
  /** `EssMeasure.key` → result. */
  measures: Record<string, EssMeasureResult>;
  defects: EssDefectRow[];
  defectTotals: { major: number; minor: number };
  /** power-on test id (as a string) → result. */
  powerOn: Record<string, EssPowerOnResult>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ESS = any asset whose NAME starts with "LION", case-insensitive.
 *
 * Deliberately a NAME test, not `waterSgProductLine`: that field drives
 * water-sg SITE CREATION on delivery acknowledgment, which these assets must
 * not trigger. The name rule also catches the two LION units whose skuKey is
 * not LION-prefixed (`ESS250A` named "LION250A", `MG20240037` named "LION376")
 * — all nine production LION assets match.
 */
export function isEssAssetName(assetName?: string | null): boolean {
  return typeof assetName === 'string' && /^\s*lion/i.test(assetName);
}

/**
 * Pick the template for a NEW report. Capture-time only — never at render.
 *
 * A SERVICE-class delivery line (WCT 2026-10-27: work done on site, no asset
 * behind it) is captured on the WCT kitchen-exhaust service report; an asset
 * named "LION…" on the ESS form; everything else on the generic checklist.
 */
export function resolveTemplateId(assetName?: string | null, opts?: { assetClass?: string | null }): MsrTemplateId {
  if (String(opts?.assetClass ?? '').toUpperCase() === 'SERVICE') return 'WCT_V1';
  return isEssAssetName(assetName) ? 'ESS_V1' : 'GENERIC_V1';
}

/**
 * Read the template a STORED report was captured on.
 * An unrecognised or absent id is GENERIC_V1 — the pre-template rows.
 */
export function templateFor(templateId?: string | null): MsrTemplateId {
  return templateId === 'ESS_V1' ? 'ESS_V1' : templateId === 'WCT_V1' ? 'WCT_V1' : 'GENERIC_V1';
}

export const TEMPLATE_VERSIONS: Record<MsrTemplateId, number> = {
  GENERIC_V1: 1,
  ESS_V1: 1,
  WCT_V1: 1,
};

export const TEMPLATE_LABELS: Record<MsrTemplateId, string> = {
  GENERIC_V1: 'Maintenance & Inspection Service Report',
  ESS_V1: 'Air-Cooled Energy Storage Inspection Report',
  WCT_V1: 'Service Report',
};

/** Stable key for one sub-item of the detailed record. */
export const essItemKey = (categoryId: number, itemId: number): string => `${categoryId}.${itemId}`;

/**
 * Suggested verdict from a reading. Null when the measure has no threshold or
 * the value is not a usable number — callers must treat null as "no opinion",
 * never as a Pass.
 */
export function suggestVerdict(measure: EssMeasure, value: unknown): EssVerdict | null {
  if (measure.threshold == null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (value === null || value === '' || Number.isNaN(n)) return null;
  return n <= measure.threshold ? 'PASS' : 'FAIL';
}

/** True when the technician's verdict contradicts the computed one. */
export function isOverridden(result?: EssMeasureResult | null): boolean {
  if (!result) return false;
  return Boolean(result.suggested && result.verdict && result.suggested !== result.verdict);
}

/** Every measure across all categories, flattened — handy for renderers. */
export const ESS_ALL_MEASURES: (EssMeasure & { categoryId: number })[] = ESS_CATEGORIES.flatMap((c) =>
  (c.measures ?? []).map((m) => ({ ...m, categoryId: c.id })),
);

/** Total sub-item count — 4+1+5+9+6+3+5+2 = 35. */
export const ESS_ITEM_COUNT = ESS_CATEGORIES.reduce((n, c) => n + c.items.length, 0);

// ─────────────────────────────────────────────────────────────────────────────
// WCT_V1 — WCT (S) Systems kitchen-exhaust SERVICE REPORT (2026-10-27).
//
// Transcribed from the client's paper report #012392 (Da Paolo Gastronomia,
// 12/10/2026, 12 pages): page 1 is the job sheet (Company / Location, Date of
// Servicing, the "Type of Service/Job" tick table), page 2 the cover letter,
// then one photo page per equipment serviced (Before / After, with the fixed
// work lines ticked under the photos), the area-cleaning photo, the SCDF / NEA
// advisory, the cleaning-frequency table and the closing lines.
//
// Captured in the FIELD APP on a SERVICE-class delivery line (a WCT job has no
// asset to scan), rendered ONLY by the server (service-report-wct.ts) so the
// office page, the field print, the customer's PDF and the email are one
// document. Wording below is the paper's VERBATIM text where the paper has it;
// the de-dusting and additions lines (no paper sample) are marked as such.
// ─────────────────────────────────────────────────────────────────────────────

export type WctJobGroupId = 'chemical' | 'dedusting' | 'additions';

export interface WctJobTypeItem {
  /** Persisted contract: `serviceData.wct.jobTypes` holds ticked ids. Never renumber. */
  id: string;
  label: string;
  /** The indented "- Consist of …" line under a (Full) system row. */
  sub?: string;
  /** The red italic "*Where accessible*" note. */
  note?: string;
}

export interface WctJobTypeGroup {
  id: WctJobGroupId;
  /** Printed as the column / band heading, colon included, as on paper. */
  title: string;
  items: WctJobTypeItem[];
}

/**
 * The "Type of Service/Job" table. Chemical Degreasing and De-Dusting print
 * side by side (left / right column, row for row); Additions and Alterations
 * is the full-width band under them.
 */
export const WCT_JOB_TYPE_GROUPS: WctJobTypeGroup[] = [
  {
    id: 'chemical',
    title: 'Chemical Degreasing :',
    items: [
      { id: 'CD_FULL', label: 'Kitchen Exhaust System (Full)', sub: 'Consist of Exhaust Hood , Fan & Ductworks', note: '*Where accessible*' },
      { id: 'CD_HOOD', label: 'Exhaust Hood' },
      { id: 'CD_FAN', label: 'Exhaust Fan' },
      { id: 'CD_DUCT', label: 'Exhaust Ductworks' },
      { id: 'CD_LOUVRE', label: 'Exhaust Louvre Grille' },
      { id: 'CD_AIR_CLEANER', label: 'Air Cleaner' },
      { id: 'CD_UV', label: 'UV Light' },
    ],
  },
  {
    id: 'dedusting',
    title: 'De-Dusting Work :',
    items: [
      { id: 'DD_FULL', label: 'Fresh Air System (Full)', sub: 'Consist of Fresh Air Ductwork & Fan/Motor', note: '*Where accessible*' },
      { id: 'DD_DUCT', label: 'Fresh Air Ductwork' },
      { id: 'DD_FAN', label: 'Fresh Air Fan' },
      { id: 'DD_GRILLE', label: 'Fresh Air Grille' },
    ],
  },
  {
    id: 'additions',
    title: 'Additions and Alterations Work :',
    items: [
      { id: 'AA_MOTOR', label: 'Replacement of Exhaust Motor' },
      { id: 'AA_UV', label: 'Installation/Replacement of UV light' },
      { id: 'AA_CARBON', label: 'Replacement of Carbon Filter' },
      { id: 'AA_BAFFLE', label: 'Replacement of Baffle Filter' },
      { id: 'AA_AC_FILTER', label: 'Replacement of Air Cleaner Filter' },
    ],
  },
];

/** Every job-type item, flattened, for lookups by id. */
export const WCT_JOB_TYPES: (WctJobTypeItem & { groupId: WctJobGroupId })[] = WCT_JOB_TYPE_GROUPS.flatMap((g) =>
  g.items.map((it) => ({ ...it, groupId: g.id })),
);

export interface WctPhotoSection {
  /** Persisted contract: key of `serviceData.wct.sections`. Never rename. */
  id: string;
  /** "Chemical Degreasing of" / "De-Dusting of" / a full heading. */
  heading: string;
  /** The underlined equipment name after the heading, when there is one. */
  subject?: string;
  /** before-after: a Before grid and an After grid. single: one grid. */
  mode: 'before-after' | 'single';
  /** Printed on every report (Unit Location, Area Cleaning). */
  always?: boolean;
  /** Printed when any of these job types is ticked. */
  jobTypes?: string[];
  /** The ✓ work lines under the photos. The tech un-ticks what was not done. */
  lines: string[];
  /** True where the lines are NOT from a paper sample (written for AIMS). */
  draftedLines?: boolean;
}

const CD_PROTECT = 'Setting up protection coverage before cleaning process begins.';
const CD_SCRAPE = 'Heavy grease accumulations are scraped.';
const CD_WASH = 'Water pressure washed.';
const CD_JOINTS = 'Checking, identify, reinforcement for leaking joints with heavy salient.';

/**
 * The photo pages, in print order. A section prints when it is `always` or
 * one of its `jobTypes` is ticked; the field form offers exactly that set.
 */
export const WCT_PHOTO_SECTIONS: WctPhotoSection[] = [
  {
    id: 'UNIT_LOCATION',
    heading: 'Unit Location',
    mode: 'single',
    always: true,
    lines: ['Checking, testing of electrical readings before service conduct.'],
  },
  {
    id: 'HOOD',
    heading: 'Chemical Degreasing of',
    subject: 'Kitchen Exhaust Hood',
    mode: 'before-after',
    jobTypes: ['CD_FULL', 'CD_HOOD'],
    lines: [CD_PROTECT, CD_SCRAPE, 'Chemical degreasing for Exhaust Hood & Grease baffle filters.', CD_WASH],
  },
  {
    id: 'FAN',
    heading: 'Chemical Degreasing of',
    subject: 'Kitchen Exhaust Fan',
    mode: 'before-after',
    jobTypes: ['CD_FULL', 'CD_FAN'],
    lines: [CD_PROTECT, CD_SCRAPE, 'Chemical degreasing for MV fan/ fan impeller/ fan hub (interior and exterior)', CD_WASH],
  },
  {
    id: 'DUCT',
    heading: 'Chemical Degreasing of',
    subject: 'Kitchen Exhaust Ductwork',
    mode: 'before-after',
    jobTypes: ['CD_FULL', 'CD_DUCT'],
    lines: [
      CD_PROTECT,
      CD_SCRAPE,
      'Chemical degreasing the exhaust ductworks inside/outside kitchen area to the its provision & 1metre before and after existing MV fan',
      CD_WASH,
      CD_JOINTS,
    ],
  },
  {
    id: 'UV',
    heading: 'Chemical Degreasing of',
    subject: 'UV Light',
    mode: 'before-after',
    jobTypes: ['CD_UV', 'AA_UV'],
    lines: [CD_PROTECT, CD_SCRAPE, 'Chemical degreasing for UV lights in the ductwork.', CD_WASH, CD_JOINTS],
  },
  {
    id: 'LOUVRE',
    heading: 'Chemical Degreasing of',
    subject: 'Exhaust Louvre Grille',
    mode: 'before-after',
    jobTypes: ['CD_LOUVRE'],
    lines: [CD_PROTECT, CD_SCRAPE, 'Chemical degreasing for exhaust lourves grille/discharge', CD_WASH, 'Checking of wire mesh condition for Exhaust lourves.'],
  },
  {
    id: 'AIR_CLEANER',
    heading: 'Chemical Degreasing of',
    subject: 'Air Cleaner',
    mode: 'before-after',
    jobTypes: ['CD_AIR_CLEANER', 'AA_AC_FILTER'],
    lines: [CD_PROTECT, CD_SCRAPE, 'Chemical degreasing for air cleaner cells and filters.', CD_WASH],
    draftedLines: true,
  },
  {
    id: 'FA_DUCT',
    heading: 'De-Dusting of',
    subject: 'Fresh Air Ductwork',
    mode: 'before-after',
    jobTypes: ['DD_FULL', 'DD_DUCT'],
    lines: [CD_PROTECT, 'Dust accumulations are removed from the fresh air ductwork inside/outside kitchen area.', 'Checking, identify, reinforcement for leaking joints.'],
    draftedLines: true,
  },
  {
    id: 'FA_FAN',
    heading: 'De-Dusting of',
    subject: 'Fresh Air Fan/Motor',
    mode: 'before-after',
    jobTypes: ['DD_FULL', 'DD_FAN'],
    lines: [CD_PROTECT, 'Dust accumulations are removed from the fresh air fan/ fan impeller/ motor (interior and exterior).', 'Fan operation checked after cleaning.'],
    draftedLines: true,
  },
  {
    id: 'FA_GRILLE',
    heading: 'De-Dusting of',
    subject: 'Fresh Air Grille',
    mode: 'before-after',
    jobTypes: ['DD_GRILLE'],
    lines: [CD_PROTECT, 'Dust accumulations are removed from the fresh air grilles.', 'Checking of grille condition.'],
    draftedLines: true,
  },
  {
    id: 'ADDITIONS',
    heading: 'Additions and Alterations Work',
    mode: 'before-after',
    jobTypes: ['AA_MOTOR', 'AA_CARBON', 'AA_BAFFLE'],
    lines: ['Replacement parts installed, tested and the system run checked.', 'Removed parts cleared from site.'],
    draftedLines: true,
  },
  {
    id: 'AREA_CLEANING',
    heading: 'Area Cleaning (After Job Completed)',
    mode: 'single',
    always: true,
    lines: ['Area cleaning of service work area and clear debris from site.'],
  },
];

/** The sections a report with these job types prints / captures, in print order. */
export function wctSectionsFor(jobTypes: readonly string[] | null | undefined): WctPhotoSection[] {
  const ticked = new Set(jobTypes ?? []);
  return WCT_PHOTO_SECTIONS.filter((s) => s.always || (s.jobTypes ?? []).some((j) => ticked.has(j)));
}

/** Most photos per Before / After / single grid (two per row, two rows, as on paper). */
export const WCT_MAX_PHOTOS_PER_GRID = 4;

/** "#012392" — the paper prints the running number six digits wide. */
export function wctReportNumber(n?: number | null): string {
  return n == null ? '#—' : `#${String(n).padStart(6, '0')}`;
}

/** The cover letter's scope sentence follows what was ticked. */
export function wctScopeSentence(jobTypes: readonly string[] | null | undefined): string {
  const groups = new Set(WCT_JOB_TYPES.filter((j) => (jobTypes ?? []).includes(j.id)).map((j) => j.groupId));
  const parts: string[] = [];
  if (groups.has('chemical') || groups.size === 0) parts.push('Chemical Degreasing of kitchen exhaust systems');
  if (groups.has('dedusting')) parts.push('De-Dusting of fresh air systems');
  if (groups.has('additions')) parts.push('Additions and Alterations work');
  return `The scope of work includes providing skilled labor and using appropriate materials to Supply and ${parts.join(', ')}.`;
}

/** Page 2 — printed, never captured (the paper's letter, verbatim). */
export const WCT_COVER_LETTER = {
  salutation: 'Dear Valued Client,',
  opening: 'With reference above, we are pleased to inform you that We have successfully completed the job at the above-mentioned location.',
  scheduled: 'The work was scheduled for the date mentioned above.',
  photos: 'Attached behind are pictures for the work conducted during the process.',
  insight: 'We hope that our report has provided you with a useful insight into the understanding of your exhaust system.',
  thanks: 'Your satisfaction is our goal, and we are looking forward to serving you better. Thank you for choosing WCT (S) Systems Pte Ltd.',
  attention: 'For your kind attention with immediate effect,',
};

export const WCT_CONTACTS: { label: string; value: string }[] = [
  { label: 'Domain Website', value: 'www.wct.com.sg' },
  { label: 'Email Address', value: 'info@wct.com.sg' },
  { label: 'For Billing/Finance/Accounting', value: 'admin@wct.com.sg' },
  { label: 'For General Matters/Enquiry/Sales', value: 'info@wct.com.sg' },
  { label: 'For Service Report', value: 'isadora@wct.com.sg' },
  { label: 'For Urgent Matters (24/7)', value: 'henry@wct.com.sg' },
];

export const WCT_VALUES: { title: string; text: string }[] = [
  {
    title: 'Our Mission',
    text: 'Working as a team, we function as a body that moves in sync with the same vision. We have always hold ourselves as a movement that stands on integrity and our utmost importance is making sure every customer is satisfied with our service. We want to be the provider, which is the most efficient and convenient to you.',
  },
  {
    title: 'Our Vision',
    text: 'We want every client to be our long-term partners, which is why it is important to us to provide you with only the highest service quality that meets levels of compliance and satisfaction so you could continue to believe in our sincerity in building a long-term business partnership with you.',
  },
  {
    title: 'Our Drive',
    text: 'While we have accomplished several huge commercial projects successfully, we still hold ourselves responsible to what you value. This drives us to constantly offer innovative and effective solutions to all needs and requirements.',
  },
];

/** The letter's signatory block. Office staff, not the technician. */
export const WCT_SIGNATORY = { regards: 'Warmest Regards,', name: 'Isadora Eng', title: 'Operational Finance', email: 'isadora@wct.com.sg' };

/** Advisory page — the paper pastes SCDF / NEA slides; the text is reproduced. */
export const WCT_ADVISORY = {
  heading: 'Advisory',
  source: '(Source from SCDF & NEA)',
  ked: {
    title: 'KED Requirements',
    points: [
      'Setback is needed from the KED when it runs outside of an eating establishment/industrial unit.',
      'Non fire rated KED shall be located minimum 3m away from LPG cylinders and pipe work. It shall not be located directly above LPG storage cabinet.',
      'The exhaust ducts and kitchen hoods (including the interior) shall be degreased and cleaned at least once every 12 months. The work shall be carried out by a specialist and the records of cleaning and degreasing shall be kept by the owner/operator for verification by relevant authority.',
    ],
  },
  enforcement: {
    title: 'ENFORCEMENT',
    points: [
      'NFSOs (not FHAN) – fine, court action for non compliance to the SCDF Fire Safety Circular – if operators fail to see that the exhaust ducts (including the interior) and kitchen hoods be degreased and cleaned at least once every 12 months',
      'The cleaning and maintenance of KED once in 12 months apply to all KED',
    ],
  },
  nea: {
    title: 'Recommended minimum cleaning frequency (NEA)',
    rows: [
      ['Floor and wall next to preparation area', 'Daily (or after operation)'],
      ['Doors', 'Weekly'],
      ['Windows, ceilings, overhead fixtures (e.g. lighting covers and fans)', 'Monthly'],
      ['Food processing equipment', 'Daily (or after operation)'],
      ['Food containers, crockery and utensils', 'Daily (or after operation)'],
      ['Food preparation table', 'Daily (or after operation)'],
      ['Sinks, taps, gullies and drains', 'Daily (or after operation)'],
      ['Exhaust hood, flue and ventilation systems', 'Monthly'],
    ],
    /** The row the paper circles in red. */
    highlight: 'Exhaust hood, flue and ventilation systems',
  },
};

export const WCT_FREQUENCY = {
  heading: 'Recommendation of Frequency',
  title: 'How Often Should You Have Your System Cleaned?',
  columns: ['Type or Volume of Cooking', 'Cleaning Frequency'],
  rows: [
    ['System serving solid fuel cooking operations', 'Monthly'],
    ['System serving high-volume cooking operations, such as 24-hour cooking, charbroiling or wok cooking.', 'Quarterly'],
    ['System serving moderate-volume cooking operations.', 'Semi-Annually'],
    ['System serving low-volume cooking operations, such as churches, day camps, seasonal businesses, senior centres', 'Annually'],
  ],
};

export const WCT_CLOSING = {
  en: 'Our management is always happy to serve you! if you have any comments and suggestions regarding our services and products, please feel free to share it with us. We value our customers and your opinions. We look forward to serving you again.',
  zh: '我们的管理人员永远乐意为您服务！如果您对我们的服务和产品有任何意见和建议，请随时与我们分享。我们重视客户和您的意见。我们期待再次为您服务。',
};

/**
 * What one photo section stores. `lines` is the ticked line INDEXES (into the
 * section's `lines`); absent = every line, which is what the field form
 * starts from. `photos` is the single grid; `before` / `after` the pair.
 */
export interface WctSectionResult {
  before?: string[];
  after?: string[];
  photos?: string[];
  lines?: number[];
}

/** The WCT payload, stored at `serviceData.wct`. */
export interface WctServiceData {
  /** Ticked "Type of Service/Job" ids (WCT_JOB_TYPES). */
  jobTypes: string[];
  /** Section id → photos and ticked lines. Only captured sections are present. */
  sections: Record<string, WctSectionResult>;
}

/** True when a section's line i is ticked on a stored result. */
export function wctLineTicked(result: WctSectionResult | undefined, i: number): boolean {
  return !result?.lines || result.lines.includes(i);
}
