# SOP — Filing an Issue in Linear (AIMS project)

Every issue filed in the AIMS project is auto-diagnosed by a Claude agent within
minutes, then picked up by a dev. Both work from **what you type**. A good report
gets a correct diagnosis and a fast fix; a vague one wastes a round-trip asking
you what you meant.

**Golden rule: write what you SEE, where you saw it, using the exact words on
the screen.** The agent literally searches the code for the labels and messages
you quote.

---

## The template (copy into every issue)

```
WHERE:   [App + screen] e.g. "DO App → Tap to Scan page" / "Portal → Accounting → Invoices list"
WHO:     [org + role] e.g. "Biofuel, field tech" / "SIDS, admin user"
DID:     [exact steps, numbered] 1. Opened delivery X  2. Tapped "Start Delivery"  3. ...
SAW:     [what actually happened — quote any message/label EXACTLY, e.g. the button "Create & Bind" stayed grey]
WANTED:  [what should have happened instead]
DOC/ID:  [any reference involved: DO number, invoice number, serial no, customer name]
WHEN:    [date/time it happened + is it every time or sometimes?]
```

For a **feature request**, swap SAW/WANTED for:

```
NOW:     [how it works today]
WANT:    [what you want instead — walk through the new flow step by step]
WHY:     [who needs it and what it saves them]
```

## Title rules

- Format: **[Area] what's wrong / what's wanted** — e.g.
  - ✅ `DO App — "Create & Bind" button greyed out when product has no match`
  - ✅ `Deliveries → DO: images don't carry over when creating the DO`
  - ❌ `bug in app` · ❌ `fix scanning` · ❌ `urgent!!`
- Name the **screen or flow** in the title. "DO App", "Invoice editor",
  "Deliveries page", "Quotation PDF" — these words route the diagnosis.

## Screenshots — required for anything visual, but caption them

Screenshots are for the dev's eyes. The agent reads **text only** (for now), so
**always add one caption line under each image** saying what it shows:

> *(screenshot: the Tap to Scan page — Submit button is below the fold, user
> must scroll to find it)*

Never let a screenshot be the ONLY carrier of key info. If the error message is
in the image, **also type the message out** — that exact string is what gets
searched in the code.

## Do / Don't

| ✅ Do | ❌ Don't |
|---|---|
| Quote exact button labels & error text: `"No matching product"` | "some error came out" |
| One issue = one problem. File 3 small issues, not 1 mega-issue | Mix a bug + 2 feature ideas in one ticket |
| Say the org: "happens for Biofuel" | Assume everyone knows which client |
| Give a real example: "DO-0231, serial AIS2026032" | "some DO" |
| Say the device for DO App issues: "Samsung tab, Android app" | Omit it (field vs office matters) |
| Mark repeatability: "every time" / "only once so far" | Leave the dev guessing if it's flaky |

## Severity (set Priority on the issue)

- **Urgent** — client blocked right now / data being lost
- **High** — feature unusable, workaround exists
- **Medium** — annoying, works with effort
- **Low** — cosmetic / nice-to-have

## Worked example (bug)

> **Title:** DO App — photos: unfinished delivery opens a blank page
>
> WHERE: DO App → Scan Asset page → unfinished-deliveries list
> WHO: Biofuel, field tech (Elroy testing)
> DID: 1. Started a delivery for DO-0231 yesterday, didn't finish  2. Today opened Scan Asset  3. Tapped the unfinished delivery in the list
> SAW: page goes completely blank, no error shown; have to kill the app
> WANTED: it should jump back to the step I left off (photos step)
> DOC/ID: DO-0231, customer Keppel
> WHEN: 5 Aug ~3pm, happens every time on this delivery
> *(screenshot: the blank page after tapping the entry)*

## Worked example (feature)

> **Title:** DO App — "Confirm and Print" receipt on lorry printer
>
> WHERE: DO App → final confirm step
> WHO: Biofuel drivers; some sites demand a physical chit
> NOW: after signature there's only Confirm; no printout possible
> WANT: a second button "Confirm and Print" that prints a receipt on the
> Bluetooth printer mounted in the lorry. Receipt must show: Model Number,
> Serial Number, Location, Signature.
> WHY: sites like X refuse handover without a physical receipt; driver
> currently writes one by hand (~5 min per drop)

---

*Issues missing WHERE or SAW/WANT will get a triage comment asking for them —
that's the round-trip this SOP exists to avoid.*
