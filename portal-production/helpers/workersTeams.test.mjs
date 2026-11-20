// Run: npm test. Workers & Teams (WCT 2026-11-20): the Settings page and the SiteClock sync dialog.
import { test } from "node:test";
import assert from "node:assert/strict";
import { memberChanges, sortRows, syncDifferences, syncSummary, teamNames, unmatchedLogins } from "./workersTeams.ts";

test("rows: active first by name; a worker's team names leave hidden teams out", () => {
  assert.deepEqual(sortRows([{ name: "b", active: false }, { name: "c", active: true }, { name: "a", active: true }]).map((r) => r.name), ["a", "c", "b"]);
  const teams = [{ id: "t1", name: "Team A", active: true, siteclockId: null, workerIds: [] }, { id: "t2", name: "Old", active: false, siteclockId: null, workerIds: [] }];
  assert.equal(teamNames({ teamIds: ["t1", "t2"] }, teams), "Team A");
  assert.deepEqual(memberChanges(["w1", "w2"], ["w2", "w3"]), { add: ["w3"], remove: ["w1"] });
});

test("sync dialog: counts, the differences AIMS keeps, logins not matched", () => {
  const r = {
    source: { workers: 12, activeWorkers: 10, teams: 3, memberships: 9, phones: false },
    counts: { workersCreate: 10, workersLink: 1, workersUpdate: 0, workersHidden: 0, workersSame: 1, teamsCreate: 3, teamsUpdate: 0, teamsHide: 0, membershipsAdd: 9, membershipsRemove: 0, loginsMatched: 8, loginsUnmatched: 2, differences: 2 },
    workers: [
      { name: "Ali", data: { name: "Ali (A)" }, differences: [{ field: "name", aims: "Ali (A)", siteclock: "Ali" }], user: { userId: "u1" }, snapshot: { active: true } },
      { name: "Kumar", data: { name: "Kumar" }, differences: [], user: null, userNote: "No AIMS login matches", snapshot: { active: true } },
      { name: "Gone", data: { name: "Gone" }, differences: [], user: null, userNote: "No AIMS login matches", snapshot: { active: false } },
    ],
    teams: [],
    memberships: { add: [], remove: [], keptRemoved: [{ worker: "Tan", team: "Team B" }] },
  };
  const lines = syncSummary(r);
  assert.equal(lines[0], "SiteClock: 12 workers (10 active), 3 teams, 9 memberships, no phone numbers (the key may not read them)");
  assert.equal(lines[1], "Workers: 10 new, 1 linked to one added by hand, 0 updated, 0 hidden, 1 unchanged");
  assert.equal(lines.at(-1), "2 differences kept as they are in AIMS");
  assert.deepEqual(syncDifferences(r), ["Ali (A): name is Ali (A) in AIMS, Ali in SiteClock", "Tan stays out of Team B (removed in AIMS)"]);
  assert.deepEqual(unmatchedLogins(r), ["Kumar: No AIMS login matches"]);
  assert.deepEqual(syncSummary(null), []);
});
