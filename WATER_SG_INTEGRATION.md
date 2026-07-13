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
    "taggedLongitude": null
  }
}
```

Field notes:
- `status` — one of `instock` | `rental` | `sold`.
- `project` — `null` when the unit has no active assignment (still returns `status`). When present, `customer` may be `null` if the project has no linked customer.
- `deploymentType` — `RENTAL` | `SALE` | `SERVICE`, or `null` when unassigned.
- `deployedDate` — ISO-8601 UTC, or `null`.
- `taggedLatitude` / `taggedLongitude` — GPS captured when the unit was field-tagged; `null` for units tagged before that feature or bound without a fix.

Example — unassigned unit:

```json
{
  "success": true,
  "data": {
    "sidId": "999", "sku": "SID 999", "assetName": "Silt Imagery Detection System",
    "status": "instock", "project": null, "deploymentType": null,
    "deployedDate": null, "taggedLatitude": 1.3521, "taggedLongitude": 103.8198
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

### Notes for water-sg

- The `siteId` water-sg already receives from AIMS on site creation **is** the AIMS SKU (`"SID 045"`) — store it and pass it (or the bare number) back to this endpoint.
- Only what's listed above is exposed. Internal IDs, financials, and other organizations' data are never returned.
- `WATER_SG_INBOUND_API_KEY` is set on the AIMS Render service and shared with water-sg out-of-band. It is distinct from the outbound `WATER_SG_API_KEY`.
