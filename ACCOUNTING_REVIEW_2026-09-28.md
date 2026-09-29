# Accounting review pack — 25–28 Sep 2026

Prepared for an accounting reviewer. Covers every change made to **Biofuel Industries Pte Ltd (prod)**
in this session: what was written to the books, what was only written in code, what is still open,
and the mistakes made along the way with how they were caught.

Org id `52e90ba8-bfbd-48b0-bb76-4f9667bf74f1` · Xero tenant `31a8a2d1-37e8-4787-a187-a2da3564f549`

---

## 1. Headline: the ledgers agree

AIMS's **imported (confirmed) journal layer matches Xero to the cent**, verified against Xero's own
journal feed (30,142 journals, 195 accounts):

| Account | Xero | AIMS (imported) | Δ |
|---|---:|---:|---:|
| 610 Accounts Receivable | 7,621,346.22 | 7,621,346.22 | **0.00** |
| 800 Accounts Payable | −2,234,579.93 | −2,234,579.93 | **0.00** |
| all other accounts | — | — | **0.00** |

The only two entries that flagged were a **renamed account**, identical balance on both sides:
Xero `Sales - Wharfage & Documentation fee` vs AIMS `Sales - Shipping & Documentation fee`, −851,073.00.

**Neither system is wrong.** Reconciliation "drift" is entirely AIMS-side work that has not been
pushed to Xero yet (section 3).

---

## 2. Changes written to the production general ledger

### 2.1 Duplicate invoice journals voided — 34 journals, $272,364.81

**Cause.** An AIMS-born invoice auto-posts its own journal (`JV-0001xx`) when confirmed. When the
accountant later authorises the same invoice in Xero, the GL sync imports Xero's journal
(`JV-XERO-*`) for that same invoice. Both sat POSTED, so the invoice was counted **twice**.

**Rule applied** (guru-approved): keep the imported Xero journal as book of record, void the
AIMS-native duplicate. Lines retained, status set to `VOID`, stamped `voidedBy`, each logged to the
Activity Log as a SYSTEM action. Reversible.

**Safety check:** a journal was voided only where an imported Xero journal existed for that invoice
**and** agreed with the AIMS document to the cent.

| Date | Journals | Amount | Notes |
|---|---:|---:|---|
| 25 Sep | 27 | 241,136.31 | 056 / 067 held back at the time |
| 28 Sep | 7 | 31,228.50 | incl. 056 / 067 once verified |
| **Total** | **34** | **272,364.81** | |

After: **0 double-posted invoices remain.** GL balanced, Dr = Cr = 754,501,034.08.

> ⚠️ **This will recur** after every batch the accountant approves in Xero, until the
> confirm-from-Xero feature (section 4.1) is deployed.

### 2.2 Stale-journal sweep — clean

52 AIMS-native posted journals checked against their source document's current total.
**0 disagreed.** The two stale ones found earlier (below) were the only cases and are now voided.

### 2.3 Document money keys backfilled — 6,406 documents, no GL effect

Additive only: new canonical keys added to `Document.config`, legacy keys retained.

```
outstandingBalance   6,160 documents     (from xeroBalance)
paidToDate           6,156               (from xeroAmountPaid)
totalWithTax         6,406               (from xeroGross)
xeroRemainingCredit    244 removed       (zero readers anywhere)
canonical vs legacy mismatches: 0 / 0 / 0
```

**Verified against a pre-change GL snapshot:** 221 accounts, all journal totals, and all legacy
money sums **identical** before and after.

---

## 3. Open items requiring an accounting decision

| # | Item | Amount | Status |
|---|---|---:|---|
| 1 | **42 Jurong Port Pte Ltd bills, Aug 2026** — uploaded into AIMS, auto-posted to the AIMS GL, **never pushed to Xero**. Xero shows only 1 Jurong bill in Aug ($626.43) against 47/221/97/72 in Apr–Jul. | 130,182.29 | Awaiting decision: push to Xero, or key in there |
| 2 | **9 AIMS-only invoices** — 6 DRAFT in Xero, 3 absent from Xero | 42,968.52 | Normal timing difference |
| 3 | **Bill 146710 dated 2028-08-15** (should be 2026) | 697.60 | Correct before pushing |
| 4 | All 42 bills are `unconfirmed` in AIMS yet posted to the GL | — | Confirm whether that is intended |
| 5 | **23 invoices newly visible on statements** once the SOA fix deploys; AR moves 7,784,788.66 → 8,210,769.75 | +425,981.09 | Review the list before go-live |

Together, items 1 and 2 explain the full AIMS-vs-Xero difference. Nothing is unexplained.

---

## 4. Code written but NOT deployed

None of this is live. It is committed to the working tree only.

### 4.1 Confirm-from-Xero — stops the double-posting recurring
`POST /xero-sync/confirm-from-xero` · flag `enableXeroConfirmSync` (**off**) · `dryRun` supported.

On each AUTHORISED/PAID Xero invoice that AIMS pushed:
- totals matched to Xero (book of record once authorised);
- **line items never rewritten** — a line-level difference is reported, not applied, because Xero
  does not carry AIMS's line detail;
- document set to `paid` / `pending_payment`;
- the AIMS-native duplicate journal voided — **only if** an imported Xero journal exists, so an
  invoice can never be left unposted.

### 4.2 Bank-rec checkpoint — "where did the accountant get to"
`GET /bank-rec/xero-checkpoints` · flag `enableBankRecXeroCheckpoint` (**off**) · read-only.

Per account per month: Xero's closing balance (Xero's own Bank Summary report) vs the AIMS GL
balance; reports `agreedThrough` and `resumeFrom`.

**Limitation, stated plainly:** this is a **period** marker, not a per-line one. Xero's bank
statement lines are behind a scope this app is not granted (`/Reports/BankStatement` → 401), and
Xero's reconciled flags sit on accounting records that do not map 1:1 to bank lines — one $130,800
bank payment is four $65,400 bill payments in Xero. The open month still has to be ticked off in AIMS.

### 4.3 Statement of Accounts fix
`statements.service.ts` read `config.xeroBalance ?? 0`. A brand-new unpaid invoice has no balance
stamped, so absent was read as **zero owed** and the invoice vanished from the statement silently.

Now routed through `owedOf()`, which falls back to the document's GST-inclusive total when no
balance has been stamped — an unpaid invoice is owed **in full**.

*Example:* `BIPL-JPSG-20260928-0001`, MSK Star Engineering, $154,531.48 — absent from the SOA;
statement showed 979,994.17 instead of 1,134,525.65.

### 4.4 Money-key rename (the `xero*` naming problem)
`xeroBalance` is **not** a Xero figure — `payments.service.ts` computes it from AIMS payments. The
Xero name is historical and is what made "absent" look like "not synced".

| was | now | note |
|---|---|---|
| `xeroBalance` | `outstandingBalance` | |
| `xeroAmountPaid` | `paidToDate` | **not** `amountPaid` — that key already exists |
| `xeroGross` | `totalWithTax` | **not** `grossTotal` — that key already exists |

Readers prefer canonical, fall back to legacy; writers stamp both. 10 services updated.
Genuinely-Xero fields (`xeroInvoiceId`, `xeroSyncedAt`, the `xeroId` columns, the integration
tables) are untouched by design.

### 4.5 Other fixes
- `saleOrderId` added to the preserved `trackingKeys` — an ordinary save was erasing the invoice's
  link to its Sales Order / Quotation.
- Invoice pricing now matches a quote by **asset identity** before the typed code.
- DO-born invoices no longer inherit `deliveryGroup` (display key) — it was collapsing invoice lines
  and discarding the accountant's edits. 10 existing invoices backfilled.

---

## 5. Errors made in this session, and how they were caught

Recorded because several produced **wrong conclusions about the books** before being corrected.

| # | Error | Effect | Caught by |
|---|---|---|---|
| 1 | Prisma `not: 'xero-import'` **silently excludes NULL** rows. Concluded accounts 334/800 had "no native postings" when they held all 42 Jurong Port bills. Made twice. | Sent the investigation chasing stale journals; a full GL wipe-and-reload was run that could never have fixed it | Breaking the balance down by `postedBy` |
| 2 | Compared the **journal** amount to Xero instead of the **document**. Reported BI202609056/067 as disputed figures needing a decision. | 2 invoices wrongly held back from cleanup; $9,592 misreported as in dispute | guru: "check aims aims is also 6867" |
| 3 | Chose `grossTotal` as a canonical key — it already exists meaning the **pre-GST subtotal** | Every statement would have been understated by GST | guru: "rmb gst is also included" |
| 4 | Chose `amountPaid` as a canonical key — already exists; reads 0 on 40 uploaded bills that Xero says are paid | Those 40 bills would have looked unpaid, inflating AP | Post-backfill value verification (40 mismatches) |
| 5 | Treated the background shell's `exit 0` as the sync's verdict; the script itself reported **drift persists** | Told guru the sync was clean when it was not | Re-reading the log |
| 6 | Proposed importing Xero's reconciliation state into AIMS bank rec | Would have matched **0 of 31** pending lines — batch payments do not map 1:1 | Testing the match before building |
| 7 | Compared GL accounts keyed on **code alone**; 196 codes are shared across organizations | A false "GL changed" alarm after the backfill | Checking the flagged account's history |

**Pattern worth noting:** every one was caught by verifying against data, not by reading code. Items
3 and 4 were caught only because the backfill was checked value-by-value afterwards.

---

## 6. What a reviewer should check

1. **The 42 Jurong Port bills** (§3.1) — are they genuinely absent from Xero, and should AIMS or Xero
   be the entry point for port bills going forward?
2. **The 23 newly visible invoices** (§3.5) — confirm each is genuinely outstanding before the SOA
   fix goes live and AR rises by $425,981.09.
3. **The voiding rule** (§2.1) — confirm that keeping Xero's journal and voiding the AIMS duplicate
   is the correct treatment, since it is about to be automated.
4. **Unconfirmed bills posting to the GL** (§3.4) — whether an `unconfirmed` document should reach
   the ledger at all.
5. **Deposit accounts** are typed CURRENT_ASSET but carry credit balances, and are gross of
   consumption — the drawdown side has never been automated.

---

## 7. Verification commands

```bash
cd api-server-production
npx ts-node --transpile-only scripts/_gl-snapshot.ts --out=/tmp/gl.json   # GL fingerprint
npx ts-node --transpile-only scripts/_gl-snapshot.ts --compare=/tmp/gl.json
npx ts-node --transpile-only scripts/_stale-je-sweep2.ts                  # stale journals
npx ts-node --transpile-only scripts/_recheck-native.ts                   # double-posting
npx ts-node --transpile-only scripts/_verify-soa.ts                       # SOA before/after
npx ts-node --transpile-only scripts/backfill-document-money.ts           # dry run
```
