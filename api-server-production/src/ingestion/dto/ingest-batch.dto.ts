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

export interface IngestBatchDto {
  type?: string; // e.g. "prepaid_daily"
  date?: string; // batch date, e.g. "2026-06-26"
  sentAt?: string;
  platform?: IngestPlatform;
  invoices?: IngestInvoice[];
  totalInvoices?: number;
  grandTotal?: { subtotal?: number; gst?: number; total?: number };
}
