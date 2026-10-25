# Shipment tracking provider: plug-in design (round AL, not built)

Status: design only. Recommended provider: **ShipsGo** (runner-up **Vizion**). Nothing is connected yet.
Wan Hai's own site blocks automated access, so AIMS never scrapes it. A licensed tracking API replaces the
screenshot / paste fallback that shipped in round AL.

## What already exists (round AL) and is reused

| Piece | Where | Reused as |
|---|---|---|
| Normalized snapshot, legs, T/S, arriving vessel (本船) | `src/shipments/carrier-tracking.ts` (`TrackingSnapshot`, `normalizeTracking`) | Provider payload → the same snapshot |
| AIMS → tracking per field, hand-typed ETA rule, weights = notes | `trackingDiff`, `etaHandTyped`, `emailAutoFields`, `updateFor` | Same rules for provider updates |
| Snapshot + history table | `ShipmentTracking` (source `PROVIDER`, `provider` column) | One row per provider update |
| Shipment fields | `Shipment.arrivingVessel / arrivingVoyageNo / tsPort / tsEta / tsEtd / blReleaseType` | Written from the provider |
| ETA history, reminders, free time, Monthly list | `ShipmentsService.update` (`etaSource`) | Provider ETA goes through it: source `tracking API` |
| Confirm UI | `TrackingPasteDialog` | "Review" of a provider update that wasn't auto-applied |

## New pieces

1. **`TrackingProvider` interface** (`src/shipments/tracking/provider.ts`):
   ```ts
   interface TrackingProvider {
     code: 'shipsgo' | 'vizion';
     subscribe(ref: { blNumber: string; carrier: CarrierCode; containers?: string[] }): Promise<{ externalId: string }>;
     unsubscribe(externalId: string): Promise<void>;
     fetch(externalId: string): Promise<unknown>;                 // polling fallback
     toSnapshot(payload: unknown): TrackingSnapshot;               // the provider's legs → our snapshot
     verifyWebhook(headers: Record<string, string>, raw: Buffer): boolean;  // HMAC / secret
   }
   ```
   One adapter per provider; only the adapter knows the provider's field names.

2. **`ShipmentTrackingSubscription` table**: organizationId, shipmentId, provider, externalId, blNumber, carrier,
   status (ACTIVE | STOPPED | FAILED), lastEventAt, lastError, createdAt. Unique (provider, externalId).

3. **Subscription lifecycle** (ADH only: orgs with the SHIPMENTS module and a new flag `enableTrackingApi`, default off):
   - Subscribe when an OPEN, non-test shipment has a B/L and a covered carrier (`carrierOf`): on B/L save and in a
     nightly sweep. One subscription per B/L (ShipsGo bills per B/L, not per container).
   - Unsubscribe when the shipment is COMPLETED / CANCELLED, or 10 days after the actual arrival.
   - Shipments the provider can't track are listed under Settings → Shipping → Tracking ("not covered: …").

4. **Updates: webhook first, polling as a backstop.**
   - `POST /webhooks/tracking/:provider` is a public route with the adapter's `verifyWebhook`. It needs entries in
     `resolveActor()` (actor "Tracking API") and `SKIP_PATHS` (no Activity Log row per ping). It answers 200
     immediately and processes asynchronously. The worker logs with `actionLog.system('tracking-api', …)`.
   - Polling cron twice a day (08:00 / 20:00 JST) calls `fetch` only for subscriptions with no event in 24 h.
     It is rate-limited and retried later on failure.

5. **Field mapping** (adapter → snapshot → shipment):

   | Shipment field | Snapshot | Provider (ShipsGo / Vizion) |
   |---|---|---|
   | vessel / voyageNo | first leg | first sea leg vessel / voyage |
   | arrivingVessel / arrivingVoyageNo (本船) | last leg when legs > 1 | last sea leg (ShipsGo `route` legs + `ts_count`; Vizion `milestones` vessel at POD) |
   | tsPort / tsEta / tsEtd | second leg's load port, first leg's arrival, second leg's departure | transhipment port events (arrival / departure) |
   | etd | first leg ETD (actual if available) | POL departure |
   | eta | ETA at the port of discharge | POD arrival (estimated, actual once arrived) |
   | actualArrivalDate | | POD actual arrival (offered only) |
   | blReleaseType | | not in the APIs; stays from screenshots / emails |
   | containerCount | number of containers | container list |
   | totalBundles / grossWeightMt | notes only | never written |

6. **Write rules** (same as carrier emails):
   - The latest ETA moves by itself, with history source `tracking API`. This doesn't happen when the current ETA was
     typed by a person (`etaHandTyped`): then a "Use this" suggestion shows on the shipment.
   - Empty fields fill. Changed non-empty fields (vessel, ports, T/S) become suggestions in the shipment panel,
     reviewed in the same dialog with ticks and Apply.
   - Weight and bundles from tracking that disagree with the B/L / PL are shown as a note and never written.
   - A payload that doesn't map (no legs, no ETA, another B/L) is stored with `error`. The shipment shows
     "Tracking unavailable" and nothing is written.
   - No WhatsApp push. The change shows in AIMS and in chat answers ("status #19-2").

7. **Settings → Shipping → Tracking:** provider, API key status (key in Render env, never in the DB), active
   subscriptions, last event per shipment, not-covered shipments, "Refresh now" per shipment.

## Carriers on open shipments (2026-10-25)

| Carrier | Shipments | ShipsGo | Vizion |
|---|---|---|---|
| Wan Hai (198GX…) | #12-1, #15-1, #16-1, #16-2, #18-1..3, #19-1, #19-2, #21-1 (EVER BRAVE, still a Wan Hai B/L), #22-1 | yes (carrier page) | yes, by B/L (data may expire 120 days after on-board) |
| Maersk | #20-1 | yes | yes |
| RCL | #14-1 | yes | yes (MBL or booking no.) |
| SITC | #17-1 | yes | yes, after support enables it |

Before signing up: run the free trial credits on 198GX06523, 276956322, GGVCB2600025201 and SITGHANG002846.
Check that the arriving vessel after transhipment and the Japan / Thailand ETA come back, and get ShipsGo's API
usage fee for 100–2,000 shipments a year in writing.
