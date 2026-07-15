# water-sg ⇄ AIMS integration

Two independent directions, each with its own secret (rotate independently):

| Direction | Purpose | Auth secret |
|---|---|---|
| **AIMS → water-sg** (outbound, existing) | On DO acknowledge, AIMS creates the site (`/api/site`, `/api/ess-site`, `/api/ecm-site`). | `WATER_SG_API_KEY` (AIMS holds it) |
| **water-sg → AIMS** (inbound, this doc) | water-sg pulls the current AIMS unit state by SIDS ID. | `WATER_SG_INBOUND_API_KEY` (water-sg holds it) |

---

## Inbound pull API — unit lookup by SIDS ID

Base URL (production): `https://<AIMS_BACKEND_HOST>` (the Render backend, e.g. the host behind `NEXT_PUBLIC_BACKEND_API_URL`).

### `GET /public-api/unit-by-sid/:sidId`

Returns the current AIMS state of the SIDS unit identified by `sidId`. Scoped to the Biofuel organization and to SIDS-line assets only.

**Auth** — present the shared inbound key as **either**:
- `Authorization: Bearer <WATER_SG_INBOUND_API_KEY>` (preferred), or
- `X-Api-Key: <WATER_SG_INBOUND_API_KEY>`

**Path param `sidId`** — accepted forms (all canonicalize to the same unit):
- bare number: `45`, `045`
- full SKU: `SID 045` (URL-encode the space → `SID%20045`)
- loose: `sid-045`, `SID045`

Canonicalization: non-digits stripped, parsed as an integer 1–999, zero-padded to 3 → matched against SKU `SID NNN` exactly.

### Response `200`

The payload is wrapped in the AIMS standard envelope; read the object under `data`:

```json
{
  "success": true,
  "message": "Action Succeeded",
  "data": {
    "sidId": "045",
    "sku": "SID 045",
    "assetName": "Silt Imagery Detection System",
    "status": "sold",
    "project": { "name": "Sembawang Beacon", "customer": "Debenho (Pte) Ltd" },
    "deploymentType": "SALE",
    "deployedDate": "2025-10-28T16:00:00.000Z",
    "taggedLatitude": null,
    "taggedLongitude": null,
    "child": { "sku": "TSS-PENDING-SID045", "simCardId": "8965010000000000001" }
  }
}
```

Field notes:
- `status` — one of `instock` | `rental` | `sold`.
- `project` — `null` when the unit has no active assignment (still returns `status`). When present, `customer` may be `null` if the project has no linked customer.
- `deploymentType` — `RENTAL` | `SALE` | `SERVICE`, or `null` when unassigned.
- `deployedDate` — ISO-8601 UTC, or `null`.
- `taggedLatitude` / `taggedLongitude` — GPS captured when the unit was field-tagged; `null` for units tagged before that feature or bound without a fix.
- `child` — the linked **Sim Card child unit** (the SIM holder — this replaced TSS in that role; TSS is still a child of the SIDS system but is never returned here). `child` is `null` when the SIDS unit has no Sim Card child; `child.simCardId` is `null` until the office fills it in AIMS. `child.sku` looks like `SIMCARD-PENDING-SID045` until completed. Display `child.simCardId` under "AIMS Unit ID" as **"Sim Card ID"**.

Example — unassigned unit:

```json
{
  "success": true,
  "data": {
    "sidId": "999", "sku": "SID 999", "assetName": "Silt Imagery Detection System",
    "status": "instock", "project": null, "deploymentType": null,
    "deployedDate": null, "taggedLatitude": 1.3521, "taggedLongitude": 103.8198,
    "child": null
  }
}
```

### Errors

| Status | When | Body (`message`) |
|---|---|---|
| `401 Unauthorized` | Missing/blank or wrong key (or the server key is unconfigured) | `Invalid or missing API key.` |
| `400 Bad Request` | `sidId` has no valid 1–999 number | `Invalid SIDS ID "abc". Expected a number 1-999 (e.g. "45", "045", or "SID 045").` |
| `404 Not Found` | No SIDS unit with that SKU in Biofuel | `No SIDS unit found for SID 500.` |

Errors use the same envelope with `success: false`.

### Examples

```bash
# Bearer
curl -H "Authorization: Bearer $WATER_SG_INBOUND_API_KEY" \
  https://<AIMS_BACKEND_HOST>/public-api/unit-by-sid/45

# X-Api-Key, full SKU form
curl -H "X-Api-Key: $WATER_SG_INBOUND_API_KEY" \
  "https://<AIMS_BACKEND_HOST>/public-api/unit-by-sid/SID%20045"
```

## Inbound pull API — list SIDS units (for the link dropdown)

### `GET /public-api/sids-units`

Same auth as `unit-by-sid` (`Authorization: Bearer <WATER_SG_INBOUND_API_KEY>` or `X-Api-Key`). Returns **every** SIDS unit in AIMS. Used to populate water-sg's "link this site to an AIMS unit" dropdown.

**⚠️ Filtering is water-sg's job.** AIMS does **not** know which units are already linked — that link lives only in water-sg (`Site.aimsUnitId`). So AIMS returns the full list, and **water-sg excludes the ones its own sites already reference** by matching each unit's `sidId` against its existing `Site.aimsUnitId` values. AIMS returns *all*; water-sg subtracts *its own linked set*.

Response `200` (under the standard `data` envelope):

```json
{
  "success": true,
  "data": {
    "units": [
      { "sidId": "025", "sku": "SID 025", "status": "sold" },
      { "sidId": "031", "sku": "SID 031", "status": "rental" },
      { "sidId": null,  "sku": "TEMP-SIDS-XYZ", "status": "instock" }
    ]
  }
}
```

- `sidId` — canonical 3-digit id, or `null` if the sku has no 1–999 number (match on `sidId`; skip nulls in the dropdown).
- `status` — `instock` | `rental` | `sold`.

### Notes for water-sg

- The `siteId` water-sg already receives from AIMS on site creation **is** the AIMS SKU (`"SID 045"`) — store it and pass it (or the bare number) back to this endpoint.
- Only what's listed above is exposed. Internal IDs, financials, and other organizations' data are never returned.
- `WATER_SG_INBOUND_API_KEY` is set on the AIMS Render service and shared with water-sg out-of-band. It is distinct from the outbound `WATER_SG_API_KEY`.
