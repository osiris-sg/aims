// Run: npm test (node --test, Node's built-in TypeScript stripping).
// Round 36 (WCT group, 2026-11-20): calendar chips (2 rows), the side panel's toggles, Cancel / Undo, Reschedule
// clashes, cross-company open, the filter bar and the WhatsApp Export list.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyToggle, canEditOnCalendar, chipLines, chipTone, colourCircle, crossOrgOpen, DEFAULT_EXPORT_HEADER, exportDateLine, exportLine, exportText, exportTime,
  filterCount, filterEvents, NO_APPLICANT, NO_FILTERS, panelDocsFallback, panelDocsFromOrder, parseFilters, ptwPillOf, rescheduleClashes, returnOrgAction,
  returnOrgMarker, shortAddress, toggleRequest, tomorrowSgt,
} from "../components/Dashboard/jobs-calendar/calendarPanel.ts";

const style = (over = {}) => ({ fill: "#039be5", text: "#ffffff", bar: null, icons: [], greyed: false, prefix: null, ...over });
const ev = (over = {}) => ({
  id: "aims:1", source: "aims", kind: "delivery", title: "ORD202611-001 · #12 Acme", start: "2026-11-03T02:00:00.000Z", end: "2026-11-03T03:00:00.000Z",
  allDay: false, status: "scheduled", statusLabel: "Scheduled", completed: false, cancelled: false, address: null, site: "Acme",
  worker: null, rider: null, crew: [], href: "/portal/deliveries/1", siteclockUrl: null, deliveryNumber: 12, doNumber: null, doTag: null, doHref: null,
  style: style(), customer: "Acme", ptwStatus: "NOT_NEEDED", doCount: 0, ...over,
});

test("chip row 1: time, ✅ / 2✅, ❌, ⭕, 📌, 🟫, customer; row 2 only when there is a prefix or a PTW", () => {
  const plain = chipLines(ev());
  assert.deepEqual(plain, { time: "10am", icons: "", customer: "Acme", row2: "" });
  const busy = chipLines(ev({ doCount: 2, sticker: true, cod: true, ptwStatus: "APPROVED", style: style({ prefix: "(SV)", applicantIcon: "🔴" }) }));
  assert.equal(busy.icons, "2✅ 📌 🟫");
  assert.equal(busy.row2, "(SV) 👍 🔴");
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
  x = applyToggle(x, { kind: "category", category: "Collect cheque" });
  assert.equal(chipLines(x).row2, "(CC)");
  x = applyToggle(x, { kind: "category", category: "Delivery" });
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

test("reschedule: clashes on the new day = same time slot or same team; the job itself, cancelled and other companies never", () => {
  const job = ev({ id: "aims:9", team: "Team A", start: "2026-11-03T02:00:00.000Z", end: "2026-11-03T03:00:00.000Z" });
  const events = [
    job,
    ev({ id: "aims:10", start: "2026-11-05T02:30:00.000Z", end: "2026-11-05T03:30:00.000Z", team: "Team B" }), // 10:30 same slot
    ev({ id: "aims:11", start: "2026-11-05T06:00:00.000Z", end: "2026-11-05T07:00:00.000Z", team: "team a" }), // 2pm same team
    ev({ id: "aims:12", start: "2026-11-05T02:00:00.000Z", end: "2026-11-05T03:00:00.000Z", cancelled: true }),
    ev({ id: "aims:13", start: "2026-11-05T02:00:00.000Z", end: "2026-11-05T03:00:00.000Z", foreign: true, orgId: "o2" }),
    ev({ id: "aims:14", start: "2026-11-06T02:00:00.000Z", end: "2026-11-06T03:00:00.000Z", team: "Team A" }), // other day
    ev({ id: "aims:15", allDay: true, start: "2026-11-05", end: null, team: "Team C" }),
  ];
  const c = rescheduleClashes(events, job, { date: "2026-11-05", time: "10:00" });
  assert.deepEqual(c.map((x) => [x.event.id, x.reasons]), [["aims:10", ["Same time"]], ["aims:11", ["Same team"]]]);
  // All day: no time clash, the team still counts.
  assert.deepEqual(rescheduleClashes(events, job, { date: "2026-11-05", time: null }).map((x) => x.event.id), ["aims:11"]);
  // No team on the job: only times.
  assert.deepEqual(rescheduleClashes(events, { ...job, team: null }, { date: "2026-11-05", time: "14:30" }).map((x) => [x.event.id, x.reasons]), [["aims:11", ["Same time"]]]);
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
  assert.equal(ids({ flags: ["cancelled"] }), "3");
  assert.equal(ids({ flags: ["postponed"] }), "4");
  assert.equal(ids({ flags: ["cod"] }), "2");
  assert.equal(ids({ flags: ["sticker"] }), "3");
  assert.equal(ids({ categories: ["site visit", "Meeting"] }), "2,3");
  assert.equal(ids({ companies: ["bcair"] }), "3");
  // The own company also covers items with no org tag (calendars without the group view).
  assert.equal(ids({ companies: ["wct"] }), "1,2,4");
  assert.equal(ids({ ptw: ["needed"], flags: ["cod"] }), "2");
  assert.equal(filterCount({ ...NO_FILTERS, doState: "yes", ptw: ["needed", "pending"], flags: ["cod"] }), 4);
  assert.deepEqual(parseFilters("junk"), NO_FILTERS);
  assert.deepEqual(parseFilters(JSON.stringify({ doState: "x", ptw: ["pending", "bad"], flags: ["cod", 3] })), { ...NO_FILTERS, ptw: ["pending"], flags: ["cod"] });
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

4pm - Hood Making @ Warehouse - Team B *Babu Drop & Pickup, Continue Night*

4pm - Ajiya Okonomiyaki Restaurant @ E!Avenue #02-346 (Troubleshoot Exhaust VSD Issue at Rooftop) - Team A *Please call the management 96420116 upon arrival*`;

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
  assert.equal(range, `*23/10/2026, Friday*\n\n*SCHEDULE*\n\n4pm - Hood Making @ Warehouse - Team B *Babu Drop & Pickup, Continue Night*\n\n4pm - Ajiya Okonomiyaki Restaurant @ E!Avenue #02-346 (Troubleshoot Exhaust VSD Issue at Rooftop) - Team A *Please call the management 96420116 upon arrival*\n\n*24/10/2026, Saturday*\n\n*SCHEDULE*\n\n10am - Next Day`);
  assert.equal(exportText(fixtureDay, { from: "2026-10-25", to: "2026-10-25", header: DEFAULT_EXPORT_HEADER }), "");
  assert.equal(tomorrowSgt(new Date("2026-11-19T17:00:00.000Z")), "2026-11-21");
  assert.equal(tomorrowSgt(new Date("2026-11-19T15:00:00.000Z")), "2026-11-20");
});
