// Run: npm test (node --test, Node's built-in TypeScript stripping).
// Round 36 (WCT group, 2026-11-20): calendar chips (2 rows), the side panel's toggles, Cancel / Undo, Reschedule
// clashes, cross-company open, the filter bar and the WhatsApp Export list.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyToggle, canEditOnCalendar, chipLines, chipTone, colourCircle, crossOrgOpen, DEFAULT_EXPORT_HEADER, exportDateLine, exportLine, exportText, exportTime,
  filterCount, filterEvents, NO_APPLICANT, NO_FILTERS, panelDocsFallback, panelDocsFromOrder, parseFilters, ptwPillOf, rescheduleClashes, returnOrgAction,
  returnOrgMarker, shortAddress, toggleRequest, tomorrowSgt, customerOf, hoverLines, scheduleLines, postponedLabel, assignedWorkers,
} from "../components/Dashboard/jobs-calendar/calendarPanel.ts";
import { readFileSync as readSrc } from "node:fs";

const style = (over = {}) => ({ fill: "#039be5", text: "#ffffff", bar: null, icons: [], greyed: false, prefix: null, ...over });
const ev = (over = {}) => ({
  id: "aims:1", source: "aims", kind: "delivery", title: "ORD202611-001 · #12 Acme", start: "2026-11-03T02:00:00.000Z", end: "2026-11-03T03:00:00.000Z",
  allDay: false, status: "scheduled", statusLabel: "Scheduled", completed: false, cancelled: false, address: null, site: "Acme",
  worker: null, rider: null, crew: [], href: "/portal/deliveries/1", siteclockUrl: null, deliveryNumber: 12, doNumber: null, doTag: null, doHref: null,
  style: style(), customer: "Acme", ptwStatus: "NOT_NEEDED", doCount: 0, ...over,
});

test("chip row 1: time, ✅ / 2✅, ❌, ⭕, 📌, 🟫, customer; row 2 only when there is a PTW", () => {
  const plain = chipLines(ev());
  assert.deepEqual(plain, { time: "10am", icons: "", customer: "Acme", row2: "" });
  // 2026-11-25: no job title, no category tag and no postponed line on Month / Week / Day chips.
  const busy = chipLines(ev({ doCount: 2, sticker: true, cod: true, ptwStatus: "APPROVED", jobTitle: "CD 1 x Air Cleaner", postponedFrom: { id: "a", date: "2026-11-28" }, style: style({ prefix: "(SV)", applicantIcon: "🔴" }) }));
  assert.equal(busy.icons, "2✅ 📌 🟫");
  assert.equal(busy.row2, "👍 🔴");
  assert.equal(JSON.stringify(busy).includes("CD 1"), false);
  assert.equal(chipLines(ev({ postponed: true, postponedTo: { id: "b", date: "2026-12-05" } })).row2, "");
  assert.equal(chipLines(ev({ doCount: 1, cancelled: true })).icons, "✅ ❌");
  assert.equal(chipLines(ev({ postponed: true })).icons, "⭕");
  // A cancelled job never shows ⭕ as well.
  assert.equal(chipLines(ev({ postponed: true, cancelled: true })).icons, "❌");
  assert.equal(chipLines(ev({ allDay: true, start: "2026-11-03" })).time, "");
  // The applicant circle only shows with a PTW.
  assert.equal(chipLines(ev({ ptwStatus: "NOT_NEEDED", style: style({ applicantIcon: "🔴" }) })).row2, "");
  assert.equal(chipLines(ev({ ptwStatus: "REQUIRED", style: style({ applicantIcon: "🟡" }) })).row2, "✋ 🟡");
  assert.equal(chipLines(ev({ ptwStatus: "SUBMITTED" })).row2, "✋");
  assert.equal(chipLines(ev({ ptwStatus: "REJECTED" })).row2, "👎");
  // No customer: the chip label, else the title without numbers.
  assert.equal(chipLines(ev({ customer: null, chipLabel: "1 Raffles Pl" })).customer, "1 Raffles Pl");
  assert.equal(chipLines(ev({ customer: null, chipLabel: undefined })).customer, "Acme");
});

test("cancelled = greyscale, postponed = greyed", () => {
  assert.equal(chipTone(ev({ cancelled: true, postponed: true })), "cancelled");
  assert.equal(chipTone(ev({ postponed: true })), "postponed");
  assert.equal(chipTone(ev()), null);
});

test("applicant colour circles: Bala 🔴, Joyna amber 🟡 (and the old yellow), Kherry 🟢", () => {
  assert.equal(colourCircle("#d50000"), "🔴");
  assert.equal(colourCircle("#c99a00"), "🟡");
  assert.equal(colourCircle("#f6bf26"), "🟡");
  assert.equal(colourCircle("#0b8043"), "🟢");
  assert.equal(colourCircle(null), "");
  assert.equal(colourCircle("red"), "");
});

test("each toggle is one API call and the chip shows the change at once", () => {
  const e = ev({ ptwStatus: "NOT_NEEDED" });
  assert.deepEqual(toggleRequest(e, { kind: "ptw", status: "REQUIRED" }, "NOT_NEEDED"), { method: "PATCH", path: "/deliveries/1/ptw", body: { ptwStatus: "REQUIRED" } });
  // Pending on an applied PTW changes nothing.
  assert.equal(toggleRequest(e, { kind: "ptw", status: "REQUIRED" }, "SUBMITTED"), null);
  assert.equal(ptwPillOf("SUBMITTED"), "REQUIRED");
  assert.deepEqual(toggleRequest(e, { kind: "sticker", on: true }), { method: "PATCH", path: "/deliveries/1/style", body: { sticker: true } });
  assert.deepEqual(toggleRequest(e, { kind: "cod", on: false }), { method: "PATCH", path: "/deliveries/1/style", body: { cod: false } });
  assert.deepEqual(toggleRequest(e, { kind: "category", category: "Site visit" }), { method: "PUT", path: "/deliveries/1/category", body: { category: "Site visit" } });
  assert.deepEqual(toggleRequest(e, { kind: "applicant", applicant: { id: "pta_bala", name: "Bala", colour: "#d50000" } }), { method: "PATCH", path: "/deliveries/1/style", body: { ptwApplicant: { id: "pta_bala", name: "Bala" } } });
  assert.deepEqual(toggleRequest(e, { kind: "team", team: "Team A + Guru" }), { method: "PATCH", path: "/deliveries/1/style", body: { team: "Team A + Guru" } });
  assert.equal(toggleRequest({ id: "sc:9" }, { kind: "cod", on: true }), null);

  const bala = { id: "pta_bala", name: "Bala", colour: "#d50000" };
  let x = applyToggle(e, { kind: "ptw", status: "REQUIRED" }, bala);
  assert.equal(chipLines(x).row2, "✋ 🔴");
  x = applyToggle(x, { kind: "ptw", status: "APPROVED" }, bala);
  assert.equal(chipLines(x).row2, "👍 🔴");
  x = applyToggle(x, { kind: "applicant", applicant: { id: "pta_kherry", name: "Kherry", colour: "#0b8043" } });
  assert.equal(chipLines(x).row2, "👍 🟢");
  x = applyToggle(x, { kind: "ptw", status: "REJECTED" }, bala);
  assert.equal(chipLines(x).row2, "👎 🟢");
  x = applyToggle(x, { kind: "ptw", status: "NOT_NEEDED" }, bala);
  assert.equal(chipLines(x).row2, "");
  x = applyToggle(x, { kind: "sticker", on: true });
  x = applyToggle(x, { kind: "cod", on: true });
  assert.equal(chipLines(x).icons, "📌 🟫");
  // 2026-11-25: no category tag on the chip any more.
  x = applyToggle(x, { kind: "category", category: "Collect cheque" });
  assert.equal(chipLines(x).row2, "");
  assert.equal(applyToggle(x, { kind: "team", team: "  " }).team, null);
  // Pending keeps an applied PTW as applied.
  assert.equal(applyToggle(ev({ ptwStatus: "SUBMITTED" }), { kind: "ptw", status: "REQUIRED" }).ptwStatus, "SUBMITTED");
});

test("cancel / undo read on the chip; another company's job is read only and opens in one click for members", () => {
  assert.equal(chipLines(ev({ cancelled: true, calendarCancelled: true })).icons, "❌");
  assert.equal(chipLines(ev({ cancelled: false })).icons, "");
  assert.equal(canEditOnCalendar(ev()), true);
  assert.equal(canEditOnCalendar(ev({ foreign: true, orgId: "o2" })), false);
  assert.equal(canEditOnCalendar(ev({ source: "siteclock" })), false);
  assert.equal(canEditOnCalendar(ev({ style: undefined })), false);
  assert.deepEqual(crossOrgOpen(ev({ foreign: true, orgId: "o2" })), { orgId: "o2", href: "/portal/deliveries/1" });
  assert.equal(crossOrgOpen(ev({ foreign: true, orgId: "o2", viewOnly: true, href: null })), null);
  assert.equal(crossOrgOpen(ev()), null);
});

test("switching back to the calendar's company: only when the tab is still on the other one, and not when stale", () => {
  const now = 1_000_000_000;
  const m = returnOrgMarker("wct", now);
  assert.equal(returnOrgAction(m, "bcair", now + 1000), "wct");
  assert.equal(returnOrgAction(m, "wct", now + 1000), null);
  assert.equal(returnOrgAction(returnOrgMarker(null, now), "bcair", now), "");
  assert.equal(returnOrgAction(returnOrgMarker(null, now), null, now), null);
  assert.equal(returnOrgAction(m, "bcair", now + 7 * 3600_000), null);
  assert.equal(returnOrgAction("junk", "bcair", now), null);
  assert.equal(returnOrgAction(null, "bcair", now), null);
});

test("panel documents: Order, then Quotation, Invoice(s), DO(s), one line each with the order page's status", () => {
  const model = {
    number: "ORD202611-011",
    statusLabel: "Invoiced",
    documents: [
      { key: "do1", kind: "do", number: "DO202611001", status: "Completed", href: "/d1" },
      { key: "inv1", kind: "invoice", number: "INV202611-0007", status: "Sent", href: "/i1" },
      { key: "q", kind: "quotation", number: "Q-014833", status: "Accepted", href: "/q" },
      { key: "j", kind: "job", number: "#41", status: "Done", href: "/j" },
      { key: "inv2", kind: "invoice", number: "INV202611-0009", status: "Draft", href: "/i2" },
      { key: "r", kind: "report", number: "SR-1", status: "Sent", href: null },
    ],
  };
  assert.deepEqual(
    panelDocsFromOrder(model, "/portal/orders/o1").map((d) => `${d.label} ${d.number} ${d.status}`),
    ["Order ORD202611-011 Invoiced", "Quotation Q-014833 Accepted", "Invoice INV202611-0007 Sent", "Invoice INV202611-0009 Draft", "DO DO202611001 Completed"],
  );
  assert.deepEqual(
    panelDocsFallback({ quotationNumber: "Q-1", quotationHref: "/q", quotationStatus: "SENT", doNumber: "DO1", doHref: "/d", doTag: "Pending" }),
    [{ key: "quotation", label: "Quotation", number: "Q-1", status: "Sent", href: "/q" }, { key: "do", label: "DO", number: "DO1", status: "Pending", href: "/d" }],
  );
  assert.equal(panelDocsFallback({ quotationNumber: "Q-1", quotationHref: "/q", viewOnly: true })[0].href, null);
});

const TA = { kind: "team", id: "t-a", name: "A" };
const TB = { kind: "team", id: "t-b", name: "B" };
test("reschedule: clashes on the new day = same time slot or same picked team; the job itself, cancelled and other companies never", () => {
  const job = ev({ id: "aims:9", team: "Team A, +2PT", crewPicks: [TA], start: "2026-11-03T02:00:00.000Z", end: "2026-11-03T03:00:00.000Z" });
  const events = [
    job,
    ev({ id: "aims:10", start: "2026-11-05T02:30:00.000Z", end: "2026-11-05T03:30:00.000Z", team: "Team B, +2PT", crewPicks: [TB] }), // 10:30 same slot; "+2PT" typed on both never counts
    ev({ id: "aims:11", start: "2026-11-05T06:00:00.000Z", end: "2026-11-05T07:00:00.000Z", team: "Team A", crewPicks: [TA] }), // 2pm same picked team
    ev({ id: "aims:16", start: "2026-11-05T08:00:00.000Z", end: "2026-11-05T09:00:00.000Z", team: "Team A" }), // 4pm "Team A" typed only: no clash
    ev({ id: "aims:12", start: "2026-11-05T02:00:00.000Z", end: "2026-11-05T03:00:00.000Z", cancelled: true }),
    ev({ id: "aims:13", start: "2026-11-05T02:00:00.000Z", end: "2026-11-05T03:00:00.000Z", foreign: true, orgId: "o2" }),
    ev({ id: "aims:14", start: "2026-11-06T02:00:00.000Z", end: "2026-11-06T03:00:00.000Z", team: "Team A" }), // other day
    ev({ id: "aims:15", allDay: true, start: "2026-11-05", end: null, team: "Team C" }),
  ];
  const c = rescheduleClashes(events, job, { date: "2026-11-05", time: "10:00" });
  assert.deepEqual(c.map((x) => [x.event.id, x.reasons]), [["aims:10", ["Same time"]], ["aims:11", ["Same team"]]]);
  // All day: no time clash, the team still counts.
  assert.deepEqual(rescheduleClashes(events, job, { date: "2026-11-05", time: null }).map((x) => x.event.id), ["aims:11"]);
  // No picked team on the job (free text only): only times.
  assert.deepEqual(rescheduleClashes(events, { ...job, crewPicks: [] }, { date: "2026-11-05", time: "14:30" }).map((x) => [x.event.id, x.reasons]), [["aims:11", ["Same time"]]]);
});

test("filters: DO, PTW, applicant, cancelled, postponed, COD, sticker, category, company", () => {
  const list = [
    ev({ id: "aims:1", doCount: 1, ptwStatus: "APPROVED", ptwApplicant: { id: "pta_bala", name: "Bala" }, category: "Service order", orgId: "wct" }),
    ev({ id: "aims:2", ptwStatus: "REQUIRED", ptwApplicant: { id: "pta_joyna", name: "Joyna" }, cod: true, category: "Site visit", orgId: "wct" }),
    ev({ id: "aims:3", ptwStatus: "REJECTED", cancelled: true, sticker: true, category: "Meeting", orgId: "bcair", foreign: true }),
    ev({ id: "aims:4", postponed: true, category: "Delivery" }),
  ];
  const ids = (f) => filterEvents(list, { ...NO_FILTERS, ...f }, "wct").map((e) => e.id.slice(5)).join(",");
  assert.equal(filterEvents(list, NO_FILTERS), list);
  assert.equal(ids({ doState: "yes" }), "1");
  assert.equal(ids({ doState: "no" }), "2,3,4");
  assert.equal(ids({ ptw: ["needed"] }), "1,2,3");
  assert.equal(ids({ ptw: ["pending"] }), "2");
  assert.equal(ids({ ptw: ["approved", "rejected"] }), "1,3");
  assert.equal(ids({ ptw: ["none"] }), "4");
  assert.equal(ids({ applicants: ["pta_joyna"] }), "2");
  assert.equal(ids({ applicants: [NO_APPLICANT] }), "3,4");
  assert.equal(ids({ categories: ["site visit", "Meeting"] }), "2,3");
  assert.equal(ids({ companies: ["bcair"] }), "3");
  // The own company also covers items with no org tag (calendars without the group view).
  assert.equal(ids({ companies: ["wct"] }), "1,2,4");
  assert.equal(ids({ ptw: ["needed"], categories: ["Meeting"] }), "3");
  assert.equal(filterCount({ ...NO_FILTERS, doState: "yes", ptw: ["needed", "pending"] }), 3);
  assert.deepEqual(parseFilters("junk"), NO_FILTERS);
  // Round 38: the old Cancelled / Postponed / COD / Sticker filters are dropped, so a filter saved before never hides jobs.
  assert.deepEqual(parseFilters(JSON.stringify({ doState: "x", ptw: ["pending", "bad"], flags: ["cod", 3] })), { ...NO_FILTERS, ptw: ["pending"] });
  assert.equal(filterEvents(list, parseFilters(JSON.stringify({ flags: ["cancelled"] })), "wct"), list);
});

test("export: times 4pm / 830pm, short address, one line per job", () => {
  assert.equal(exportTime({ start: "2026-10-23T08:00:00.000Z", allDay: false }), "4pm");
  assert.equal(exportTime({ start: "2026-10-23T12:30:00.000Z", allDay: false }), "830pm");
  assert.equal(exportTime({ start: "2026-10-23T04:00:00.000Z", allDay: false }), "12pm");
  assert.equal(exportTime({ start: "2026-10-22T16:00:00.000Z", allDay: false }), "12am");
  assert.equal(exportTime({ start: "2026-10-23T02:15:00.000Z", allDay: false }), "1015am");
  assert.equal(exportTime({ start: "2026-10-23", allDay: true }), "");
  assert.equal(shortAddress("E!Avenue #02-346, Singapore 039393"), "E!Avenue #02-346");
  assert.equal(shortAddress("1 Raffles Link\n#02-01\nS(039393)"), "1 Raffles Link, #02-01");
  assert.equal(shortAddress("Blk 5 Ang Mo Kio Ind Park 2A, 567760"), "Blk 5 Ang Mo Kio Ind Park 2A");
  assert.equal(shortAddress(null), "");
  assert.equal(exportLine(ev({ start: "2026-10-23T08:00:00.000Z", customer: "Acme *Pte*", address: null, subject: null, team: null, remarks: null })), "4pm - Acme Pte");
  // Remarks prefilled from the Subject are not repeated.
  assert.equal(exportLine(ev({ start: "2026-10-23T08:00:00.000Z", customer: "Acme", subject: "Clean hood", remarks: "clean hood" })), "4pm - Acme (Clean hood)");
  assert.equal(exportLine(ev({ allDay: true, start: "2026-10-23", customer: "Acme" })), "All day - Acme");
  assert.equal(exportDateLine("2026-10-20"), "*20/10/2026, Tuesday*");
});

// The sample from Elroy (20 Nov), on a fixture Friday (23 Oct 2026; the sample's 20/10/2026 is a Tuesday).
const SAMPLE = `*23/10/2026, Friday*

Workers to sign back all DOs & inform in gc if there's no one to sign off

*SCHEDULE*

4pm - Hood Making @ Warehouse - Team B *Remarks: Babu Drop & Pickup, Continue Night*

4pm - Ajiya Okonomiyaki Restaurant @ E!Avenue #02-346 (Troubleshoot Exhaust VSD Issue at Rooftop) - Team A *Remarks: Please call the management 96420116 upon arrival*`;

const fixtureDay = [
  ev({ id: "aims:21", title: "#21 Hood Making", start: "2026-10-23T08:00:00.000Z", end: "2026-10-23T10:00:00.000Z", customer: "Hood Making", address: "Warehouse", team: "Team B", remarks: "Babu Drop & Pickup\nContinue Night" }),
  ev({ id: "aims:22", title: "ORD202610-004 · #22 Ajiya Okonomiyaki Restaurant", start: "2026-10-23T08:00:00.000Z", end: "2026-10-23T09:00:00.000Z", customer: "Ajiya Okonomiyaki Restaurant", address: "E!Avenue #02-346, Singapore 039393", subject: "Troubleshoot Exhaust VSD Issue at Rooftop", team: "Team A", remarks: "Please call the management 96420116 upon arrival" }),
  ev({ id: "aims:23", start: "2026-10-23T03:00:00.000Z", customer: "Cancelled Co", cancelled: true }),
  ev({ id: "aims:24", start: "2026-10-23T05:00:00.000Z", customer: "On Hold Co", postponed: true }),
  ev({ id: "sc:25", source: "siteclock", start: "2026-10-23T05:00:00.000Z", customer: "SiteClock job" }),
  ev({ id: "aims:26", start: "2026-10-24T02:00:00.000Z", customer: "Next Day" }),
];

test("export text matches the sample for a fixture day (cancelled and on hold left out by default)", () => {
  assert.equal(exportText(fixtureDay, { from: "2026-10-23", to: "2026-10-23", header: DEFAULT_EXPORT_HEADER }), SAMPLE);
});

test("export: cancelled / on hold when asked, a range = one block per date, an empty header drops its line, nothing = empty", () => {
  const withCancelled = exportText(fixtureDay, { from: "2026-10-23", to: "2026-10-23", header: DEFAULT_EXPORT_HEADER, includeCancelled: true });
  assert.ok(withCancelled.includes("11am - Cancelled Co"));
  assert.ok(!withCancelled.includes("On Hold Co"));
  assert.ok(exportText(fixtureDay, { from: "2026-10-23", to: "2026-10-23", header: "", includeOnHold: true }).includes("1pm - On Hold Co"));
  const range = exportText(fixtureDay, { from: "2026-10-23", to: "2026-10-24", header: "" });
  assert.equal(range, `*23/10/2026, Friday*\n\n*SCHEDULE*\n\n4pm - Hood Making @ Warehouse - Team B *Remarks: Babu Drop & Pickup, Continue Night*\n\n4pm - Ajiya Okonomiyaki Restaurant @ E!Avenue #02-346 (Troubleshoot Exhaust VSD Issue at Rooftop) - Team A *Remarks: Please call the management 96420116 upon arrival*\n\n*24/10/2026, Saturday*\n\n*SCHEDULE*\n\n10am - Next Day`);
  assert.equal(exportText(fixtureDay, { from: "2026-10-25", to: "2026-10-25", header: DEFAULT_EXPORT_HEADER }), "");
  assert.equal(tomorrowSgt(new Date("2026-11-19T17:00:00.000Z")), "2026-11-21");
  assert.equal(tomorrowSgt(new Date("2026-11-19T15:00:00.000Z")), "2026-11-20");
});

// Round 39 (WCT group, 2026-11-20): the side panel's documents, one line per type, and the quotation's real status.
import { panelDocGroups, PANEL_DOC_LIMIT } from "../components/Dashboard/jobs-calendar/calendarPanel.ts";

test("panel docs: one line per type (plural when several), quotation shows its real status, not Imported", () => {
  const model = {
    number: "ORD-Q-014739",
    statusLabel: "Part billed",
    documents: [
      { key: "q:1", kind: "quotation", number: "Q-014739", status: "Imported", href: "/q" },
      { key: "i:1", kind: "invoice", number: "I-014739", status: "Paid", href: "/i1" },
      { key: "i:2", kind: "invoice", number: "I-014897", status: "Unpaid", href: "/i2" },
      { key: "d:1", kind: "do", number: "DO012538", status: "Completed", href: null },
    ],
  };
  const docs = panelDocsFromOrder(model, "/portal/orders/o1", "Unconfirmed · ERP draft");
  assert.equal(docs.find((d) => d.key === "q:1").status, "Unconfirmed · ERP draft");
  // Without the label (older API): the order page's own wording, as before.
  assert.equal(panelDocsFromOrder(model, null).find((d) => d.key === "q:1").status, "Imported");
  const groups = panelDocGroups(docs);
  assert.deepEqual(groups.map((g) => [g.label, g.docs.map((d) => `${d.number} ${d.status}`)]), [
    ["Order", ["ORD-Q-014739 Part billed"]],
    ["Quotation", ["Q-014739 Unconfirmed · ERP draft"]],
    ["Invoices", ["I-014739 Paid", "I-014897 Unpaid"]],
    ["DO", ["DO012538 Completed"]],
  ]);
  assert.equal(PANEL_DOC_LIMIT, 6);
  // A job with no order: the server's label wins over the raw status.
  assert.equal(panelDocsFallback({ quotationNumber: "Q-1", quotationStatus: "confirmed", quotationStatusLabel: "Declined" })[0].status, "Declined");
  assert.equal(panelDocsFallback({ quotationNumber: "Q-1", quotationStatus: "confirmed" })[0].status, "Confirmed");
});

// Round 39 #8: the job dialogs' warning above Save (never blocks).
import { slotHints, crewParts, BUSY_SLOT } from "../components/Dashboard/jobs-calendar/calendarPanel.ts";

test("slot hints: same picked team / worker at the same time, 3+ jobs in the slot, never the job itself or cancelled ones", () => {
  // 20 Nov 2026, Singapore time (UTC+8): 10:00-11:00 is 02:00-03:00Z.
  const job = (id, startZ, endZ, over = {}) => ({ id, source: "aims", title: id, start: startZ, end: endZ, allDay: false, cancelled: false, crew: [], ...over });
  const GURU = { kind: "worker", id: "w-guru", name: "Guru" };
  const events = [
    job("aims:1", "2026-11-20T02:00:00Z", "2026-11-20T03:00:00Z", { team: "Team A, Guru, +2pt", crewPicks: [TA, GURU], customer: "Jewel Changi" }),
    job("aims:2", "2026-11-20T02:30:00Z", "2026-11-20T03:30:00Z", { team: "Team B, +2PT", crewPicks: [TB], customer: "Ion Orchard" }),
    job("aims:3", "2026-11-20T02:15:00Z", "2026-11-20T02:45:00Z", { team: null, customer: "Bugis" }),
    job("aims:4", "2026-11-20T02:00:00Z", "2026-11-20T03:00:00Z", { team: "Team A", crewPicks: [TA], customer: "Gone", cancelled: true }),
    job("aims:5", "2026-11-20T06:00:00Z", "2026-11-20T07:00:00Z", { team: "Team A", crewPicks: [TA], customer: "Later" }),
  ];
  assert.deepEqual(crewParts("Team A + Guru, Ali"), ["team a", "guru", "ali"]);
  assert.equal(BUSY_SLOT, 3);
  // 10:00 for an hour, Team A picked: clashes with job 1 (Team A picked there too); the slot holds 3 live jobs.
  assert.deepEqual(slotHints(events, { date: "2026-11-20", time: "10:00", durationMin: 60, crew: [TA] }), ["A already has a job then: Jewel Changi", "3 jobs already at this time"]);
  // Two shared picks: both named, "have".
  assert.deepEqual(slotHints(events, { date: "2026-11-20", time: "10:00", durationMin: 60, crew: [TA, GURU] })[0], "A, Guru already have a job then: Jewel Changi");
  // Owner's screenshot (2026-11-25): Team C, Elroy, Team B, Babu picked + "+2PT" typed; Team B is busy, "+2PT" never counts.
  const mine = [{ kind: "team", id: "t-c", name: "C" }, { kind: "worker", id: "w-elroy", name: "Elroy" }, TB, { kind: "worker", id: "w-babu", name: "Babu" }];
  assert.deepEqual(slotHints(events.slice(0, 1), { date: "2026-11-20", time: "10:00", durationMin: 60, crew: mine }), []);
  assert.deepEqual(slotHints(events.slice(1, 2), { date: "2026-11-20", time: "10:00", durationMin: 60, crew: mine }), ["B already has a job then: Ion Orchard"]);
  // Editing job 1 itself: no clash with itself; 2 others left, not busy.
  assert.deepEqual(slotHints(events, { date: "2026-11-20", time: "10:00", durationMin: 60, crew: [TA], excludeId: "1" }), []);
  // Nothing picked: only the busy slot.
  assert.deepEqual(slotHints(events, { date: "2026-11-20", time: "10:00", durationMin: 60 }), ["3 jobs already at this time"]);
  // 2pm: job 5 (Team A picked) overlaps; picks also match by name (same kind).
  assert.deepEqual(slotHints(events, { date: "2026-11-20", time: "14:00", durationMin: 30, crew: [{ kind: "team", id: "other-id", name: "a" }] }), ["A already has a job then: Later"]);
  // The shared Schedule dialog's picked SiteClock worker (a name) against the jobs' picked names only.
  assert.deepEqual(slotHints(events, { date: "2026-11-20", time: "10:00", durationMin: 60, pickedName: "guru" })[0], "Guru already has a job then: Jewel Changi");
  assert.deepEqual(slotHints(events, { date: "2026-11-20", time: "10:00", durationMin: 60, pickedName: "+2pt" }), ["3 jobs already at this time"]);
  // No specific time: the whole day (4 live jobs).
  assert.deepEqual(slotHints(events, { date: "2026-11-20", time: null, durationMin: 60 }), ["4 jobs already at this time"]);
  assert.deepEqual(slotHints(events, { date: "", time: "10:00", durationMin: 60 }), []);
});

test("export (23 Nov): all-day jobs and all-day notes first as 'All day', then the timed jobs by time", () => {
  const day = [
    ev({ id: "aims:2", customer: "Late Co", start: "2026-11-24T08:00:00.000Z", end: "2026-11-24T09:00:00.000Z", address: "1 Late Rd" }),
    ev({ id: "aims:3", customer: "Allday Co", allDay: true, start: "2026-11-24", end: null, address: "2 Day Rd", subject: "Duct check" }),
    ev({ id: "aims:4", customer: "Early Co", start: "2026-11-24T01:00:00.000Z", end: "2026-11-24T02:00:00.000Z" }),
  ];
  const notes = [
    { title: "Leave", staffName: "Ali", startDate: "2026-11-23", endDate: "2026-11-25", allDay: true, remark: null },
    { title: "Road closed", staffName: null, startDate: "2026-11-24", endDate: "2026-11-24", allDay: false, startTime: "09:00", endTime: "10:00" },
  ];
  const out = exportText(day, { from: "2026-11-24", to: "2026-11-24", header: "" }, notes);
  assert.equal(out, ["*24/11/2026, Tuesday*", "*SCHEDULE*", "All day - Allday Co @ 2 Day Rd (Duct check)", "All day - Leave · Ali", "9am - Early Co", "4pm - Late Co @ 1 Late Rd"].join("\n\n"));
  // A day with only an all-day note is listed; timed notes never.
  assert.equal(exportText([], { from: "2026-11-25", to: "2026-11-25", header: "" }, notes), ["*25/11/2026, Wednesday*", "*SCHEDULE*", "All day - Leave · Ali"].join("\n\n"));
  // Cancelled all-day jobs follow the usual rule (left out unless ticked).
  assert.ok(!exportText([ev({ allDay: true, start: "2026-11-24", cancelled: true, customer: "Gone Co" })], { from: "2026-11-24", to: "2026-11-24", header: "" }).includes("Gone Co"));
});


// ── 2026-11-24 batch: Shop name, hover, Schedule row, postponed pair, holidays in the export ─────────────────────
test("name rule: Shop name when filled, else the customer", () => {
  assert.equal(customerOf(ev({ customer: "Gokoku Pte Ltd", shopName: "Gokoku Japanese Bakery" })), "Gokoku Japanese Bakery");
  assert.equal(customerOf(ev({ customer: "Gokoku Pte Ltd", shopName: "  " })), "Gokoku Pte Ltd");
});

test("hover: name, time, Salesperson, Created by, PTW applicant, Team / crew, Assigned workers; no order or job number", () => {
  const e = ev({ title: "ORDW202611-002 · #15 Spicy", customer: "Spicy", shopName: "Spicy @ Vivo", salesperson: { id: "s", name: "Henry Hoo" }, createdBy: { id: "c", name: "Kherry" }, team: "Team B", worker: "Ali", crew: [{ name: "Ali" }, { name: "Bala" }], orderNumber: "ORDW202611-002", deliveryNumber: 15 });
  const lines = hoverLines(e, "9:00 am – 10:00 am", "Bala");
  assert.deepEqual(lines, ["Spicy @ Vivo", "9:00 am – 10:00 am", "Salesperson: Henry Hoo", "Created by: Kherry", "PTW applicant: Bala", "Team / crew: Team B", "Assigned workers: Ali, Bala"]);
  assert.ok(!lines.join(" ").includes("ORDW") && !lines.join(" ").includes("#15"));
  assert.deepEqual(assignedWorkers({ worker: "ali", crew: [{ name: "Ali" }] }), ["ali"]);
});

test("Schedule row (phone format): line 1 name @ address (subject) - team | remarks; line 2 workers · QO · salesperson · created by", () => {
  const l = scheduleLines(ev({ customer: "Gokoku", address: "Vivo City #B2-09, Singapore 098585", subject: "CD 1 x Air Cleaner", team: "Team B", remarks: "Please don't wear uniform", worker: "Ali", quotationNumber: "Q-013776", salesperson: { id: "s", name: "Kherry" }, createdBy: { id: "c", name: "joyna" } }));
  assert.deepEqual(l, { name: "Gokoku", where: "Vivo City #B2-09", subject: "CD 1 x Air Cleaner", team: "Team B", remarks: "Please don't wear uniform", line2: "Ali · Q-013776 · Kherry · Created by joyna", postponed: "" });
  // The postponed line lives on the Schedule row (not the chips) since 2026-11-25.
  assert.equal(scheduleLines(ev({ postponedFrom: { id: "a", date: "2026-11-28" } })).postponed, "Postponed from 28/11");
});

test("postponed pair: labels, export line of the old record, records always listed", () => {
  assert.equal(postponedLabel({ postponedTo: { id: "b", date: "2026-12-05" } }), "Postponed to 05/12");
  assert.equal(postponedLabel({ postponedFrom: { id: "a", date: "2026-11-28" } }), "Postponed from 28/11");
  assert.equal(postponedLabel({}), "");
  const rec = ev({ id: "aims:a", customer: "Old Co", postponed: true, recordOnly: true, postponedTo: { id: "b", date: "2026-12-05" }, start: "2026-11-28T02:00:00.000Z", end: "2026-11-28T03:00:00.000Z" });
  const live = ev({ id: "aims:c", customer: "Live Co", start: "2026-11-28T06:00:00.000Z", end: "2026-11-28T07:00:00.000Z" });
  assert.equal(exportLine(rec), "⭕ Postponed to 05/12 - Old Co");
  const out = exportText([live, rec], { from: "2026-11-28", to: "2026-11-28", header: "" });
  assert.equal(out, ["*28/11/2026, Saturday*", "*SCHEDULE*", "⭕ Postponed to 05/12 - Old Co", "2pm - Live Co"].join("\n\n"));
});

test("public holiday at the top of its day in the export (a day with only the holiday too)", () => {
  const out = exportText([], { from: "2026-12-25", to: "2026-12-25", header: "" }, [], [{ date: "2026-12-25", name: "Christmas Day" }]);
  assert.equal(out, ["*25/12/2026, Friday*", "Public holiday: Christmas Day", "*SCHEDULE*"].join("\n\n"));
});

test("one job form wiring: panel Edit top right + Complete job, no Open job; old job page redirects to the calendar", () => {
  const read = (p) => readSrc(new URL(`../${p}`, import.meta.url), "utf8");
  const panel = read("components/Dashboard/jobs-calendar/StyledJobPanel.tsx");
  assert.match(panel, /data-tour="jobs-calendar-panel-edit"/);
  assert.match(panel, /data-tour="jobs-calendar-panel-complete"/);
  assert.ok(!/>\s*Open job\s*</.test(panel), "no Open job button");
  assert.match(panel, /const editable = !!actions && canEditOnCalendar\(e\) && !e\.recordOnly;/);
  // Complete job only on a job of an order (the server completes order jobs only).
  assert.match(panel, /e\.status === "scheduled" && !!e\.orderNumber && \(/);
  const dialog = read("components/Dashboard/jobs-calendar/QuickJobDialog.tsx");
  assert.match(dialog, /label="Shop name"/);
  assert.match(dialog, /<JobEditDetails/);
  assert.match(dialog, /Complete job/);
  const page = read("app/portal/deliveries/[id]/page.tsx");
  assert.match(page, /router\.replace\(`\/portal\/deliveries\/calendar\?\$\{next\.toString\(\)\}`\)/);
  assert.match(page, /const oneForm = features\?\.enableCalendarStyle === true;/);
  assert.match(read("app/portal/deliveries/_components/WctJobsList.tsx"), /oneForm \? setJobEdit\(\{ id, mode: "edit" \}\)/);
  const view = read("components/Dashboard/jobs-calendar/CalendarView.tsx");
  assert.match(view, /SCHEDULE_FONT = \{ text: "0\.875rem", time: "0\.75rem", row2: "0\.75rem" \}/);
  assert.match(view, /holidayCalendarInputs\(holidays \?\? \[\]\)/);
  // The outer chip element's hover is the styled hover, never the old "#21 Customer / Category" text.
  assert.match(view, /if \(styledEv\?\.style\) \{\s*arg\.el\.title = styledTooltip\(styledEv\);/);
});
