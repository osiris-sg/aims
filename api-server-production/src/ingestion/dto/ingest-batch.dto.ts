// ---------------------------------------------------------------------------
// Payload shapes for the Biofuel weighbridge JSON batch ingestion endpoint.
//
// These are plain TS interfaces (not class-validator DTOs). The global
// ValidationPipe runs with transform:true but NO whitelist, so the rich nested
// payload passes through untouched; we validate it manually in the service so
// we can return per-invoice error rows instead of a single 400.
// ---------------------------------------------------------------------------

export interface IngestPlatform {
  name?: string;
  uen?: string;
  address?: string;
  contactNumber?: string;
}

export interface IngestClient {
  name?: string;
  uen?: string;
  address?: string;
  attention?: string;
  mobile?: string;
  email?: string;
}

export interface IngestInvoice {
  transactionId: string; // UNIQUE — idempotency key
  invoiceNumber: string;
  client: IngestClient;
  subClient?: IngestClient | null;
  pickupLocation?: string | null;
  licensePlate?: string;
  materialType?: string;
  entryWeightKg?: number;
  exitWeightKg?: number;
  disposedWeightKg?: number;
  chargedWeightKg?: number;
  minLoadKg?: number; // real feed — "Min. Load" in kg (÷1000 for the (T) column)
  ratePerTonne?: number;
  minLoadTonnes?: number; // legacy fallback (already in tonnes)
  soilSubtotal?: number; // real feed — soil-disposal subtotal
  subtotal?: number; // legacy fallback
  gstAmount?: number;
  transport?: number | null; // optional extra transport charge (total = soilSubtotal + transport + gst)
  totalCharge?: number;
  timestamp?: string;
}

// ---- postpaid_consolidated (ONE period invoice per request) ---------------

export interface PostpaidInvoiceHeader {
  invoiceNumber: string; // idempotency key for postpaid
  invoiceDate?: string; // DD/MM/YYYY
  periodFrom?: string; // DD/MM/YYYY
  periodTo?: string; // DD/MM/YYYY
  currency?: string;
}

export interface PostpaidMaterialSummary {
  description?: string;
  qtyTonnes?: number;
  rate?: number; // S$ per tonne
  gstPercent?: number;
  subtotal?: number;
  gst?: number;
  amount?: number; // subtotal + gst
}

export interface PostpaidDailyBreakdown {
  date?: string; // DD/MM/YYYY
  items?: Array<{ materialType?: string; tonnes?: number; loads?: number }>;
}

export interface IngestBatchDto {
  type?: string; // "prepaid_daily" | "jp_passes_daily" | "postpaid_consolidated"
  date?: string; // batch date, e.g. "2026-06-26" (daily types)
  sentAt?: string;
  platform?: IngestPlatform;
  // daily types:
  invoices?: IngestInvoice[];
  totalInvoices?: number;
  grandTotal?: { subtotal?: number; gst?: number; total?: number };
  // postpaid_consolidated:
  invoice?: PostpaidInvoiceHeader;
  client?: IngestClient;
  materialSummaries?: PostpaidMaterialSummary[];
  dailyBreakdowns?: PostpaidDailyBreakdown[];
  transportSummaries?: unknown | null; // shape TBD — stored raw for audit
  totals?: { soilSubtotal?: number; gst?: number; transportSubtotal?: number | null; total?: number };
  transactionCount?: number;
  paymentMethod?: string; // "bank_transfer" | "airwallex" — expected rail (unpaid)
}
