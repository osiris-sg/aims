# WCT: Google Calendar to AIMS import (how-to, 2026-11-25)

Source: the Google Calendars seen by service@wct.com.sg ("Jessy WCT"; in Chrome it is account slot `/u/2`). Google stays read only: view and export, never edit, RSVP or change settings.

## 1. Export from Google (read only)
1. calendar.google.com/calendar/u/2/r/settings/export > **Export**. The zip (`service@wct.com.sg.ical.zip`) holds only the calendars the account owns: Jessy WCT and Birthdays. Unzip it to `~/Downloads/gcal-export/main-export/`.
2. Shared calendars (Amy, Kherry, Rave, Joyna, Nee Meng, Nathan, Henry, Isadora, Thillai, Yonny, Joanne, ALL TYPE OF LEAVES, ...) have no "Export calendar" in Settings (only owners and managers get it). Read them from the Schedule view instead:
   - Schedule view from 1 Oct 2026: collect every event chip's label (when, title, calendar, date) into `~/Downloads/gcal-export/gcal-ui-scrape.json`.
   - Open each work event's pop-up (read only, then Close) for its description. Save the result as `gcal-ui-desc-by-eid.json`, as `{ eventId: description }`.
   - Then run `npx ts-node --transpile-only scripts/gcal/gcal-ui-to-ics.ts ~/Downloads/gcal-export` (in api-server-production). It writes one ICS per calendar to `~/Downloads/gcal-export/ui-ics/`.
3. Calendars hidden in the sidebar (unticked) do not show in the Schedule view, so they are not read: PTW Status, Site Visit / Meeting, WCTR Worker Schedule. Ticking them is a Google display setting the owner has to allow.

## 2. Which calendars are imported (owner, 25 Nov 2026)
`api-server-production/scripts/gcal/wct-gcal-calendars.json` lists, per calendar:
- the ICS file;
- include true / false;
- `personal: true` for calendars that are never imported (the script refuses to run if one is included);
- the salesperson (an AIMS user's full name in WCT (S)) or null;
- `ptwApplicant` (Bala).

Owner decisions:
- **Dropped as personal:** Isadora, Isadora's Personal Reminder, Henry, Birthdays.
- **Dropped as duplicate:** Holidays in Singapore (AIMS has its own public holidays).
- **Dropped per event**, in any calendar: an event with no "Name @ Address" and a tuition / revision / birthday / family word. They are listed in the dry run.
- **One-off events** from 1 Oct 2026 onward.
- **Repeating events** come in as repeating jobs / notes (CalendarSeries) with Google's rule, EXDATEs and changed / moved occurrences (each one its own job / note, linked to the series), never capped.
  - A series that started before 1 Oct 2026 and still has occurrences after it comes in as a series.
  - Only the Settings > Export ICS carries the rule (exact). The Schedule view shows repeating instances with no rule: they would come in one by one and are counted in the dry run.
- **Salesperson by calendar:**
  - Amy > Amy Yap
  - Jessy WCT > Jessy WCT
  - Joyna > Joyna Chua
  - Rave > Rave Ng
  - Nee Meng > Nee Meng Tan
  - Henry > Henry Hoo (calendar dropped)
  - every other calendar: none
  - Users are found by the names the Activity Log recorded for WCT (S) members, else the salesperson alias map.

## 3. Commands (api-server-production, prod, owner's go needed for every APPLY)
Run the two steps in this order:

```
# Step 2: clear ALL jobs, notes and repeating series of WCT (S), BC Air, Racking, YMM
npx ts-node --transpile-only scripts/wct-gcal-clear.ts                          # dry run
npx ts-node --transpile-only scripts/wct-gcal-clear.ts --apply --confirm-prod     # delete

# Step 3 / 4: import into WCT (S) (re-runnable)
npx ts-node --transpile-only scripts/wct-gcal-import.ts                          # dry run
npx ts-node --transpile-only scripts/wct-gcal-import.ts --apply --confirm-prod    # write
npx ts-node --transpile-only scripts/wct-gcal-import.ts --apply --confirm-prod --delete-missing   # also delete imported records whose Google event is gone
```

**Clear** deletes:
- jobs, with their job lines, proof rows (DO_START / DO_ACK / DO_INSTALL), field values, notifications, share links and unsent group posts;
- calendar notes.

It keeps:
- every document: quotations, orders, DOs, invoices;
- service reports, payments, journals, customers, workers and public holidays;
- job photos, SiteClock sync rows and attendance rows. Jobs already pushed to SiteClock are NOT cancelled there.

**Import** creates jobs (Delivery), notes (CalendarNote) and repeating series (CalendarSeries + exceptions) in WCT (S) only. Each one keeps its Google calendar id, event id, last-updated time and a hash, in the inactive custom field `gcal_import`. A re-run matches on that key:
- a new event is created;
- a changed event is updated;
- a gone event is listed, and deleted only with `--delete-missing`.

Series match on CalendarSeries.source.key; a changed rule or exception list is updated.

Jobs and notes the import did not make are never touched.

Title rules: `<marks><Name> @ <Address> (<Job title>) - <Team / workers> *<remarks>*`.

| Mark | Means in AIMS |
|---|---|
| 🔴 / 🟡 / 🟢 | PTW needed, applicant Bala / Joyna / Kherry |
| ✋ 👍 👎 | PTW pending / approved / rejected |
| ❌ | cancelled |
| ⭕ | postponed |
| 📌 | sticker |
| 🟫 | COD |
| ✅ | not imported: AIMS shows it from real DOs |
| 📅 | leave note |
| 🚫 | blockage note |

Other rules:
- Any other event without "@" becomes a general note.
- A Q-number in the description or title links the job to the order `ORD-Q-<no.>`. That order's customer is used when the name has no exact match.
- The salesperson is the event's calendar, through the WCT salesperson alias map.

Parser tests: `npx jest --rootDir . scripts/gcal/gcal-title.spec.ts --maxWorkers=2`.
