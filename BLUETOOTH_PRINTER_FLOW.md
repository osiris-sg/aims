# Bluetooth thermal-printer flow — preservation note

_Snapshot of the field-app Bluetooth receipt-printing flow as of `65206fb`,
before the pivot to Sunmi built-in printers. This branch (`bluetooth-printer-flow`)
preserves the working chain so a future session can restore it without
re-deriving the ESC/POS + RFCOMM tuning._

## What it was

The AIMS Field Android app (Capacitor shell) printed delivery-order receipts to
a **Xprinter XP-58IIH-class 58mm thermal printer** over **Classic Bluetooth SPP**.
Web Bluetooth is BLE-only by spec and can never reach an SPP printer, so printing
required a **native Capacitor plugin** — it does NOT work in a plain browser
session (the Print buttons gate on `isPrinterAvailable()` and stay disabled off-device).

Riders printed a receipt at two points:
- **Live, at hand-off** — the after-ack "done" step, right after the customer signs.
- **Reprint, after the fact** — the finished-deliveries list (last 7 days of the
  rider's own completed runs), reusing the same receipt builder.

The receipt is a **run-level itemized delivery order**: every item on the run
(unit-backed *and* free-typed) is listed once under one customer signature.

## Files that carry the flow

| Layer | Path |
|---|---|
| **Native plugin (SPP)** | `portal-production/android/app/src/main/java/so/osiris/aims/field/BtPrinterPlugin.java` |
| **Web bridge + ESC/POS builder + signature rasterizer** | `portal-production/app/(field)/lib/btPrinter.ts` |
| **Live print wiring (hand-off)** | `portal-production/app/(field)/scan/delivery/[deliveryId]/after-ack/page.tsx` (`doPrint`, printer-picker dialog, `buildDeliveryReceipt` call) |
| **Finished-deliveries reprint — list** | `portal-production/app/(field)/scan/deliveries/finished/page.tsx` |
| **Finished-deliveries reprint — detail + REPRINT** | `portal-production/app/(field)/scan/deliveries/finished/[deliveryId]/page.tsx` |
| **Entry point** | `portal-production/app/(field)/scan/page.tsx` ("Reprint a delivery" button) |

`btPrinter.ts` exports: `isPrinterAvailable`, `getSavedPrinter`, `savePrinter`,
`listBondedDevices`, `buildDeliveryReceipt`, `printBytes`, and the
`DeliveryReceiptData` / `DeliveryReceiptItem` types. The chosen printer is
remembered per phone in `localStorage` (`aims.btprinter.device`); pairing itself
happens in Android Settings — the plugin only ever lists already-bonded devices.

## ⚠️ APK requirement (the big one)

`BtPrinterPlugin.java` is **native code**. Any change to it — or first-time
adoption on a device — requires **rebuilding and sideloading the AIMS Field APK**.
It is NOT delivered by the Vercel web deploy. The web-side files (`btPrinter.ts`,
the print pages) DO ship via Vercel, but they can only call a plugin that is
already compiled into the installed APK. So:
- Pure web-side receipt changes (layout, item list, wording) → Vercel deploy only.
- Any `BtPrinterPlugin.java` change → **APK rebuild + sideload**, then web deploy.

## XP-58IIH / ESC/POS specifics (all tuned the hard way)

- **Transport:** Classic Bluetooth **RFCOMM/SPP**, standard SPP UUID
  `00001101-0000-1000-8000-00805F9B34FB`. Runtime `BLUETOOTH_CONNECT` on API 31+.
- **Width:** **384 dots/line** = 32 chars/line at normal size on 58mm. The rule
  line is 32 `-` chars; signature raster fills to ≤384 (job uses 320) dots wide.
- **Encoding:** printer speaks CP437-ish; `btPrinter.ts` maps anything outside
  printable ASCII (0x20–0x7E) to `?` so nothing turns to mojibake on paper.
- **Signature:** rasterized to a 1-bit `GS v 0` block. The signature-pad export is
  a large mostly-empty canvas, so the builder finds the **ink bounding box**
  (lenient threshold 200 to keep anti-aliased stroke tails), crops + pads 16px,
  scales the crop to fill width (≤360 dots tall), then thresholds at luminance 128.

### The delays/quirks we tuned (in `BtPrinterPlugin.java`)

- **`CHUNK_SIZE = 512`** — chunk the `write()` syscall (SPP buffers are small),
  but with **NO inter-chunk delay**. A temporal gap *inside* a raster command
  (`GS v 0`) makes cheap firmware time out waiting for image data and revert to
  text mode — printing raster bytes as ASCII. Back-to-back writes form one
  continuous RFCOMM stream (write-call boundaries are not wire gaps); RFCOMM
  credit-based flow control supplies the backpressure the old per-chunk sleep faked.
- **`CONNECT_SETTLE_MS = 300`** — pause after the RFCOMM socket opens, before the
  first bytes. Skipping it races link setup → garbled leading block on the first
  print after connecting.
- **`CLEAR_ON_CONNECT = { 0x10, 0x05, 0x02, 0x1B, 0x40 }`** — sent right after
  connect: `DLE ENQ 2` (real-time "clear receive + print buffers") + `ESC @`
  (reset formatting). Discards a prior job's undrained tail so it can't be flushed
  at the head of the next receipt (which otherwise prints the previous raster
  payload as ASCII). Harmless on printers that ignore `DLE ENQ`.
- **`BUFFER_CLEAR_SETTLE_MS = 150`** — pause after the clear so it takes effect
  before the job starts.
- **`DRAIN_DELAY_MS = 600`** — hold after the final `flush()` before resolving
  `write()`. The caller calls `disconnect()` (→ `socket.close()`) immediately
  after; without the drain, undrained RFCOMM bytes (recipient name + trailing
  feed) are cut off mid-tail.
- **Job envelope (`btPrinter.ts` `buildDeliveryReceipt`):** starts with `ESC @`
  (init), ends with `feed(8)` (the head sits ~1cm above the tear bar; 8 lines
  clears it for a clean tear) then a trailing `ESC @` to leave the printer in a
  known state for the next job. No cutter — 58mm tear-bar hardware.
- **`disconnect()` after every job** — connect → write → disconnect each print;
  the on-connect buffer-clear is what makes re-connecting safe.

## How to restore

`git checkout bluetooth-printer-flow` gives the full working chain at `65206fb`.
Cherry-pick or merge the files above back onto the live branch, then **rebuild and
sideload the APK** (the native plugin is the part the web deploy can't carry).
