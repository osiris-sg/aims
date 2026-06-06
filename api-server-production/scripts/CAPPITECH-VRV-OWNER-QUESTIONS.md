# Cappitech VRV — Questions for the Owner

Open questions to resolve the VRV import (`scripts/import-cappitech-vrv.js`, 291 assets
imported flat into org Cappitech on the dev DB, 2026-06-06). Answers feed corrections +
the document-display work. See `cappitech-pricelist-import.md` (memory) for context.

## A. Pricing & commercial
1. **Dealer/discount pricing for VRV?** The R32 sheets had a Dealer column; these VRV
   sheets are **list-price only**. Is there a separate VRV dealer price list, or is VRV
   sold at list? (Dealer is currently blank for all VRV.)
2. **Points for VRV?** No points column on the sheets. Do VRV products earn points
   (Route Order "Less Points"), or is points R32-only?
3. **Wired vs wireless remote default** — each indoor unit is priced both ways (~$20–115
   apart). Imported the **wired** price as default. Is wired correct, or should some
   types default to wireless?

## B. Product modelling / quotation behaviour
4. **Mix-and-match (flat) or scoped like SkyAir?** Currently any indoor pairs with any
   outdoor (no CU↔FCU links). Is that how VRV is quoted, or scope the indoor picker per
   outdoor?
5. **Remotes & panels as line items?** Show BRC remotes / BYCQ panels as separate,
   taggable accessories (auto-added per FCU like SkyAir), or keep them bundled into the
   FCU price as now?
6. **Black-panel cassettes (FXFSQ)** — only the white-panel default was imported. Do they
   sell the black-panel option (~+$350)? If yes: separate SKU or a panel option?
7. **Combination outdoor units** — stored as one priced unit with the module list in the
   description. Do they ever quote/order the **individual modules + piping kit
   separately**, or always as the one combined model?

## C. Data accuracy to confirm (OCR was shaky on the dense outdoor tables)
8. **VRV IV – three 95 kW rows** (`RQQ34TSYM` / `RQQ34TNYM` / `RQQ34TYMG`): confirm all
   three exist and the third model code (faint in the photo).
9. **16 kW VRV IV** — set to `RQQ06TYMG`. Confirm (and the price ~$11,984, oddly higher
   than the 22.4 kW unit).
10. **VRV 6X 50 / 56 kW** — set to `RXUQ18BYMG` / `RXUQ20BYMG`. Confirm.
11. **Can they share the VRV price list as Excel/PDF?** Would let us replace all the
    medium-confidence outdoor rows in one pass instead of row-by-row verification.

## D. Displaying in documents
12. **How should capacity show on the quotation?** A dedicated "Capacity (kW)" column, or
    inside the model description? (Stored as `Asset.capacityKw`, not yet displayed.)
13. **Which fields visible on the VRV quotation row** — model, capacity, combination,
    ticks (energy rating)? In particular, show the **energy "tick" rating** to customers?
    (Stored for outdoor, not displayed.)

---

# Cappitech Chillers / Chilled-Water FCU / Air Streamer — Questions for the Owner

Second import batch (`scripts/import-cappitech-chillers-cwfcu.js`, 242 assets, dev DB,
2026-06-06). Daikin "Applied Product" photos IMG_2271–2283. Three new categories:
`Chiller`, `Chilled Water Fan Coil Unit`, `Air Purifier`.

## E. Pricing model (set vs base)
1. **Set pricing** — Scroll Chillers (Chiller + Controller + Set), Cassette FCUs (FCU +
   Panel + Set), and most chilled-water FCUs (FCU + Controller + Set) have a bundled
   **Set Price**. Imported `price` = the **base** (chiller/FCU) price, with Controller/
   Panel + Set parked in `customPrices`. When they quote, do they quote the **Set price**
   (bundle) or the base unit + separate controller/panel line? This decides which becomes
   the headline price.
2. **Controller is uniformly $173** across nearly all chilled-water FCUs — confirm that's
   right (one generic controller), and whether it should be a separate quote line.
3. **Air Streamer dealer price** — these have List + Dealer (like the R32 consumer
   range). Stored Dealer under the `"Discount Price"` label. Should air streamers use the
   dealer-pricing flow in quotations?

## F. Capacity units
4. **Chillers: Tons vs kW** — water-cooled centrifugal + R407c screw are rated in **Tons**;
   I converted to kW (×3.517) for `capacityKw` and kept "X Tons" in the description. Do
   they want **Tons** shown on documents instead of kW for chillers?

## G. Categorisation / behaviour
5. **New categories OK?** `Chiller`, `Chilled Water Fan Coil Unit` (kept separate from the
   VRV/SkyAir "Fan Coil Unit"), `Air Purifier`. Any of these belong together / renamed?
6. **Controllers as taggable accessories?** BRC51A62, AC8800-*, Netpro/BAG cards imported
   under `Accessories`. Tag them to the relevant FCUs (auto-add) like SkyAir, or leave
   loose?

## H. Data accuracy to confirm (medium/low-confidence pages)
7. **Scroll Chiller (IMG_2275)** — medium confidence. Confirm the Mini-Scroll model codes
   (first row read as `UAL240ERS-YPAE` for 11.6 kW — likely should be `UAL040ERS`?) and
   the two Inverter rows' prices (`UAL230EYDS-FBAE` $22,150 / `UAL450EYDS-FBAE` $36,820).
8. **Can they share these Applied-Product lists as Excel/PDF?** Several pages were
   watermark-obscured; a clean copy would let us verify chiller prices (these run
   $80k–$840k, so accuracy matters more than the FCUs).
