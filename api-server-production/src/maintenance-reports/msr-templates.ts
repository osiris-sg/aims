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

export type MsrTemplateId = 'GENERIC_V1' | 'ESS_V1';

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
 * OPERATION & MAINTENANCE RECOMMENDATIONS — the reference's five fixed
 * paragraphs. PRINTED, NEVER CAPTURED: the field form does not ask for these
 * and must not, because they are standing advice about the class of equipment,
 * not an observation about this visit.
 *
 * Item 5 carries the next maintenance date, so the list is BUILT rather than
 * stored — a stored copy would freeze whatever date was current at capture and
 * then disagree with the report's own Next Service Date after any edit. With no
 * date set it falls back to the reference's own blank rule, which is what the
 * paper form shows when the date has not been agreed yet.
 */
export const ESS_NEXT_DATE_BLANK = '_____ (Year) _____ (Month) _____ (Day)';

export function essRecommendations(nextServiceDate?: string | null): string[] {
  return [
    'Air-cooled energy storage systems are highly sensitive to dust accumulation. It is recommended to inspect and clean air filters every 1–3 months and replace filters every 6 to 12 months, so as to prevent battery overheating and excessive temperature differential caused by blocked air ducts.',
    'Regularly inspect the operating condition of cooling fans. Conduct aging assessment after 2 years of operation and replace degraded fans in advance to mitigate the risk of cooling system failure.',
    'During plum rain and high-humidity seasons, prioritize inspection of the cabinet enclosure sealing performance to prevent internal condensation, which may lead to reduced insulation capacity and electrical faults.',
    'Export background operation logs monthly, and continuously monitor battery voltage differential, cluster temperature differential and equipment alarm trends to enable proactive risk identification and preventive maintenance.',
    `Next scheduled maintenance date: ${nextServiceDate?.trim() || ESS_NEXT_DATE_BLANK}`,
  ];
}

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

/** Pick the template for a NEW report. Capture-time only — never at render. */
export function resolveTemplateId(assetName?: string | null): MsrTemplateId {
  return isEssAssetName(assetName) ? 'ESS_V1' : 'GENERIC_V1';
}

/**
 * Read the template a STORED report was captured on.
 * An unrecognised or absent id is GENERIC_V1 — the pre-template rows.
 */
export function templateFor(templateId?: string | null): MsrTemplateId {
  return templateId === 'ESS_V1' ? 'ESS_V1' : 'GENERIC_V1';
}

export const TEMPLATE_VERSIONS: Record<MsrTemplateId, number> = {
  GENERIC_V1: 1,
  ESS_V1: 1,
};

export const TEMPLATE_LABELS: Record<MsrTemplateId, string> = {
  GENERIC_V1: 'Maintenance & Inspection Service Report',
  ESS_V1: 'Air-Cooled Energy Storage Inspection Report',
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
