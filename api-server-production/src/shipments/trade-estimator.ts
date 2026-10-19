/**
 * Courier cost + import tax estimator (shipment steps 7, 8 and 12), after
 * ADH's task list. Everything is JPY; every rate is an org setting
 * (TradeSetting.estimatorRates) and every input is editable on the shipment
 * (Shipment.costs). Pure.
 *
 *   trucks          = ROUND(gross weight / truck capacity)            (editable)
 *   customs (通関)   = qty × customs rate × 1.1                         (rate 2,800 or 2,300 /MT per customer)
 *   B/L fee         = 11,800 per B/L
 *   AN charges      = THC + documentation fee + equipment management charge (from the Arrival Notice)
 *   est. 通関・車輸送 = customs + B/L fee + AN charges
 *   trucking        = trucks × truck rate × 1.1                        (20t: 98,000; 10t: 26,000)
 *   storage / other = manual, optional 20,000 / container line
 *   import tax est. = the 輸入許可書 formula (trade-customs.ts): 申告価格 = ⌊CIF USD × customs weekly
 *                     rate⌋ + 加算運賃 (JPY add-on, default the A/N's EQMC); 消費税 7.8% of ⌊申告価格⌋₁₀₀₀,
 *                     地方消費税 22/78 of it, each ⌊⌋₁₀₀ — #11: ¥18,386,700
 * Step 12 actuals (Mitsui Soko invoices): customs, B/L fee, trucking,
 * storage, washing (6,000/CNT + tax), detention (4,000/CNT + tax) — shown
 * against the estimate with the variance.
 */
import { importTax, ImportTaxBreakdown } from './trade-customs';

export interface EstimatorRates {
  /** Consumption tax multiplier for customs / trucking (1.1). */
  taxMultiplier: number;
  /** 通関 (一貫作業) JPY/MT by default; a customer profile can set its own (Nagoya 2,300). */
  customsPerMt: number;
  blFee: number;
  /** Trucking rate per truck by capacity (t): { "20": 98000, "10": 26000 }. */
  truckRates: Record<string, number>;
  storagePerContainer: number;
  /** 保管料 JPY/MT in a single invoice's 通関、車輸送料 line (Kato sheet: 200). */
  storagePerMt: number;
  washingPerContainer: number;
  detentionPerContainer: number;
}

export const DEFAULT_RATES: EstimatorRates = {
  taxMultiplier: 1.1,
  customsPerMt: 2800,
  blFee: 11800,
  truckRates: { '20': 98000, '10': 26000 },
  storagePerContainer: 20000,
  storagePerMt: 200,
  washingPerContainer: 6000,
  detentionPerContainer: 4000,
};

/** Stored rates over the defaults (unknown / bad values ignored). */
export function ratesOf(stored: unknown): EstimatorRates {
  const s = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>;
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : d);
  const trucks = s.truckRates && typeof s.truckRates === 'object' ? (s.truckRates as Record<string, unknown>) : {};
  return {
    taxMultiplier: num(s.taxMultiplier, DEFAULT_RATES.taxMultiplier),
    customsPerMt: num(s.customsPerMt, DEFAULT_RATES.customsPerMt),
    blFee: num(s.blFee, DEFAULT_RATES.blFee),
    truckRates: { ...DEFAULT_RATES.truckRates, ...Object.fromEntries(Object.entries(trucks).filter(([k, v]) => /^\d+$/.test(k) && typeof v === 'number' && v >= 0)) } as Record<string, number>,
    storagePerContainer: num(s.storagePerContainer, DEFAULT_RATES.storagePerContainer),
    storagePerMt: num(s.storagePerMt, DEFAULT_RATES.storagePerMt),
    washingPerContainer: num(s.washingPerContainer, DEFAULT_RATES.washingPerContainer),
    detentionPerContainer: num(s.detentionPerContainer, DEFAULT_RATES.detentionPerContainer),
  };
}

/** Per-shipment estimator inputs and actuals (Shipment.costs). Every value optional; null = use the default. */
export interface ShipmentCosts {
  trucks?: number | null;
  customsRatePerMt?: number | null;
  truckCapacityT?: number | null;
  /** Arrival Notice charges (JPY). */
  thc?: number | null;
  docFee?: number | null;
  equipmentFee?: number | null;
  storage?: number | null;
  /** Optional 20,000/CNT line: container count to charge. */
  storageContainers?: number | null;
  other?: number | null;
  /** Import tax (step 8): CIF of the SG→JP IV and the customs weekly rate (円/USD). */
  cifUsd?: number | null;
  fxRate?: number | null;
  /** 加算運賃: JPY added to the customs value (permit code E); null = the A/N's EQMC. */
  customsAddOnJpy?: number | null;
  importTaxFunded?: number | null;
  importTaxActual?: number | null;
  /** Step 12 actuals from Mitsui Soko invoices (JPY). */
  actual?: {
    customs?: number | null;
    blFee?: number | null;
    trucking?: number | null;
    storage?: number | null;
    washingContainers?: number | null;
    detentionContainers?: number | null;
    washing?: number | null;
    detention?: number | null;
    other?: number | null;
  };
}

const nz = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const roundYen = (v: number) => Math.round(v + 1e-9);

/** Trucks needed: ROUND(gross weight / capacity), at least 1 when there is any weight. 307.004t on 20t trucks (SUS) → 15; 40.825t on 10t (Kato) → 4. */
export function trucksFor(grossWeightMt: number | null | undefined, capacityT: number): number | null {
  const g = nz(grossWeightMt);
  if (g === null || !capacityT) return null;
  return Math.max(g > 0 ? 1 : 0, Math.round(g / capacityT));
}

/** Truck rate for a capacity (exact key, else the nearest capacity listed). */
export function truckRateFor(rates: EstimatorRates, capacityT: number): number {
  const exact = rates.truckRates[String(capacityT)];
  if (exact !== undefined) return exact;
  const keys = Object.keys(rates.truckRates)
    .map(Number)
    .sort((a, b) => Math.abs(a - capacityT) - Math.abs(b - capacityT));
  return keys.length ? rates.truckRates[String(keys[0])] : 0;
}

export interface Estimate {
  qtyMt: number | null;
  grossMt: number | null;
  truckCapacityT: number;
  trucks: number | null;
  trucksSuggested: number | null;
  customsRatePerMt: number;
  customs: number | null;
  blFee: number;
  anCharges: number;
  /** Est. 通関・車輸送 = customs + B/L fee + AN charges. */
  customsTotal: number | null;
  truckRate: number;
  trucking: number | null;
  storage: number;
  other: number;
  total: number | null;
  /** Import tax (step 8). */
  importTax: {
    cifUsd: number | null;
    fxRate: number | null;
    /** ⌊CIF × FX⌋. */
    cifJpy: number | null;
    /** 加算運賃 and where it came from (typed, or the A/N's EQMC). */
    addOnJpy: number;
    addOnSource: 'typed' | 'EQMC' | null;
    /** 申告価格 / 課税標準 / 消費税 / 地方消費税. */
    customsValue: number | null;
    taxBase: number | null;
    national: number | null;
    local: number | null;
    estimate: number | null;
    funded: number | null;
    actual: number | null;
    variance: number | null;
  };
}

/**
 * The estimate for one shipment: net weight drives customs, gross weight the
 * trucks. `profile` gives the customer's truck size and customs rate.
 */
export function estimate(
  input: { netWeightMt?: unknown; grossWeightMt?: unknown },
  costs: ShipmentCosts | null | undefined,
  rates: EstimatorRates,
  profile: { truckCapacityT?: number; customsRatePerMt?: number } = {},
): Estimate {
  const c = costs ?? {};
  const qty = nz(input.netWeightMt);
  const gross = nz(input.grossWeightMt) ?? qty;
  const capacity = nz(c.truckCapacityT) ?? profile.truckCapacityT ?? 20;
  const suggested = trucksFor(gross, capacity);
  const trucks = nz(c.trucks) ?? suggested;
  const customsRate = nz(c.customsRatePerMt) ?? profile.customsRatePerMt ?? rates.customsPerMt;
  const customs = qty === null ? null : roundYen(qty * customsRate * rates.taxMultiplier);
  const anCharges = (nz(c.thc) ?? 0) + (nz(c.docFee) ?? 0) + (nz(c.equipmentFee) ?? 0);
  const customsTotal = customs === null ? null : customs + rates.blFee + anCharges;
  const truckRate = truckRateFor(rates, capacity);
  const trucking = trucks === null ? null : roundYen(trucks * truckRate * rates.taxMultiplier);
  const storage = (nz(c.storage) ?? 0) + (nz(c.storageContainers) ?? 0) * rates.storagePerContainer;
  const other = nz(c.other) ?? 0;
  const total = customsTotal === null || trucking === null ? null : customsTotal + trucking + storage + other;
  const cifUsd = nz(c.cifUsd);
  const fx = nz(c.fxRate);
  const typedAddOn = nz(c.customsAddOnJpy);
  const eqmc = nz(c.equipmentFee);
  const addOnJpy = typedAddOn ?? eqmc ?? 0;
  const tax = cifUsd === null || fx === null ? null : importTax(cifUsd, fx, addOnJpy);
  const actual = nz(c.importTaxActual);
  return {
    qtyMt: qty,
    grossMt: gross,
    truckCapacityT: capacity,
    trucks,
    trucksSuggested: suggested,
    customsRatePerMt: customsRate,
    customs,
    blFee: rates.blFee,
    anCharges,
    customsTotal,
    truckRate,
    trucking,
    storage,
    other,
    total,
    importTax: {
      cifUsd,
      fxRate: fx,
      cifJpy: tax?.cifJpy ?? null,
      addOnJpy,
      addOnSource: typedAddOn !== null ? 'typed' : eqmc !== null ? 'EQMC' : null,
      customsValue: tax?.customsValue ?? null,
      taxBase: tax?.taxBase ?? null,
      national: tax?.national ?? null,
      local: tax?.local ?? null,
      estimate: tax?.total ?? null,
      funded: nz(c.importTaxFunded),
      actual,
      variance: actual === null || !tax ? null : actual - tax.total,
    },
  };
}

/** Import tax (consumption + local) for a CIF at the customs rate plus the JPY add-on — see trade-customs.ts. */
export function importTaxEstimate(cifUsd: number | null, fxRate: number | null, addOnJpy = 0): ImportTaxBreakdown | null {
  return cifUsd === null || fxRate === null ? null : importTax(cifUsd, fxRate, addOnJpy);
}

export interface ActualRow {
  key: 'customs' | 'blFee' | 'trucking' | 'storage' | 'washing' | 'detention' | 'other';
  label: string;
  estimate: number | null;
  actual: number | null;
  variance: number | null;
}

/** Step 12: est vs actual per line, with the variance (actual − estimate). Washing / detention are per container + tax. */
export function actualsTable(e: Estimate, costs: ShipmentCosts | null | undefined, rates: EstimatorRates): { rows: ActualRow[]; estimate: number; actual: number; variance: number } {
  const a = costs?.actual ?? {};
  const perCnt = (n: unknown, rate: number) => (nz(n) === null ? null : roundYen((nz(n) as number) * rate * rates.taxMultiplier));
  const washing = nz(a.washing) ?? perCnt(a.washingContainers, rates.washingPerContainer);
  const detention = nz(a.detention) ?? perCnt(a.detentionContainers, rates.detentionPerContainer);
  const row = (key: ActualRow['key'], label: string, est: number | null, act: number | null): ActualRow => ({
    key,
    label,
    estimate: est,
    actual: act,
    variance: act === null || est === null ? null : act - est,
  });
  const rows: ActualRow[] = [
    row('customs', '通関 (一貫作業 + 税) + AN charges', e.customs === null ? null : e.customs + e.anCharges, nz(a.customs)),
    row('blFee', 'B/L fee (輸入通関料)', e.blFee, nz(a.blFee)),
    row('trucking', 'Trucking (運送料 + 税)', e.trucking, nz(a.trucking)),
    row('storage', 'Storage (保管料)', e.storage || null, nz(a.storage)),
    row('washing', 'Washing (水洗い ¥6,000/CNT + 税)', null, washing),
    row('detention', 'Detention (¥4,000/CNT + 税)', null, detention),
    row('other', 'Other', e.other || null, nz(a.other)),
  ];
  const sum = (pick: (r: ActualRow) => number | null) => rows.reduce((s, r) => s + (pick(r) ?? 0), 0);
  const est = sum((r) => r.estimate);
  const act = sum((r) => r.actual);
  return { rows, estimate: est, actual: act, variance: act - est };
}

/**
 * Invoice #2 / single-invoice cost lines suggested from the estimator, in
 * USD at the invoice FX: 通関、車輸送料 (taxable) = customs-total − B/L fee +
 * trucking; 通関 (non-taxable) = the B/L fee (輸入通関料). Rounded down to cents
 * as ADH's sheet does.
 */
export function suggestedCostLinesUsd(e: Estimate, fxRate: number | null): { customsTaxable: number | null; customsNonTaxable: number | null } {
  if (!fxRate || fxRate <= 0) return { customsTaxable: null, customsNonTaxable: null };
  const down2 = (v: number) => Math.floor(v * 100 + 1e-7) / 100;
  const taxableJpy = e.customsTotal === null || e.trucking === null ? null : e.customsTotal - e.blFee + e.trucking + e.storage;
  return { customsTaxable: taxableJpy === null ? null : down2(taxableJpy / fxRate), customsNonTaxable: down2(e.blFee / fxRate) };
}

/** Validate a costs patch from the form (numbers ≥ 0 or null); returns the cleaned object. */
export function cleanCosts(raw: unknown, fail: (msg: string) => never): ShipmentCosts {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const NUM_KEYS = [
    'trucks',
    'customsRatePerMt',
    'truckCapacityT',
    'thc',
    'docFee',
    'equipmentFee',
    'storage',
    'storageContainers',
    'other',
    'cifUsd',
    'fxRate',
    'customsAddOnJpy',
    'importTaxFunded',
    'importTaxActual',
  ] as const;
  const ACT_KEYS = ['customs', 'blFee', 'trucking', 'storage', 'washingContainers', 'detentionContainers', 'washing', 'detention', 'other'] as const;
  const clean = (v: unknown, k: string) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 1e12) fail(`${k} must be a number ≥ 0`);
    return n;
  };
  const out: ShipmentCosts = {};
  for (const k of NUM_KEYS) if (k in r) (out as Record<string, unknown>)[k] = clean(r[k], k);
  if (r.actual && typeof r.actual === 'object') {
    out.actual = {};
    for (const k of ACT_KEYS) if (k in (r.actual as object)) (out.actual as Record<string, unknown>)[k] = clean((r.actual as Record<string, unknown>)[k], `actual.${k}`);
  }
  return out;
}
