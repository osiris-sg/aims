// Run: npm test. Round 39 B4: the jobs' Team / crew picker (teams + workers, free text kept).
import { test } from "node:test";
import assert from "node:assert/strict";
import { chipsToValue, crewChips, crewDisplay, crewOptionList, sameCrew, splitFree } from "./crewPicker.ts";

test("existing free text stays as typed; picks come first", () => {
  assert.deepEqual(splitFree("Team B + Ah Seng"), ["Team B", "Ah Seng"]);
  assert.deepEqual(splitFree("Team A, Guru"), ["Team A, Guru"]);
  const chips = crewChips([{ kind: "team", id: "t1", name: "Team A" }], "Ali (lorry)");
  assert.deepEqual(chips, [{ kind: "team", id: "t1", name: "Team A" }, "Ali (lorry)"]);
  assert.deepEqual(chipsToValue(chips), { crew: [{ kind: "team", id: "t1", name: "Team A" }], team: "Ali (lorry)" });
  // A legacy value round-trips unchanged.
  assert.deepEqual(chipsToValue(crewChips([], "Team B + Ah Seng")), { crew: [], team: "Team B + Ah Seng" });
  assert.equal(crewDisplay([{ kind: "team", id: "t1", name: "Team A" }, { kind: "worker", id: "w1", name: "Guru" }], null), "Team A + Guru");
});

test("options: teams then workers; duplicates and blanks dropped", () => {
  const opts = crewOptionList({ teams: [{ id: "t1", name: "Team A", workerIds: ["w1"] }], workers: [{ id: "w1", name: "Guru" }] });
  assert.deepEqual(opts, [{ kind: "team", id: "t1", name: "Team A" }, { kind: "worker", id: "w1", name: "Guru" }]);
  assert.deepEqual(chipsToValue([opts[0], opts[0], "  ", "x", "x"]), { crew: [{ kind: "team", id: "t1", name: "Team A" }], team: "x" });
  assert.equal(sameCrew(opts[0], { kind: "team", id: "t1", name: "renamed" }), true);
  assert.equal(sameCrew("a", "a"), true);
  assert.equal(sameCrew(opts[0], "Team A"), false);
});
