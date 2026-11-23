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

// 2026-11-24 (WCT group): chips duplicated ("Team A" twice) or came back after a delete. Reproduction in state
// terms: the API sends teamText null for a job with picks and no free text; the panel then passes e.team (the
// WHOLE text, "Team A") as the free text, so the picker showed [pick Team A, text "Team A"]. Deleting the pick
// kept the text chip (it "came back"); deleting the text sent team "", the panel fell back to e.team again and the
// text chip reappeared; any other edit saved "Team A" as free text (a stored duplicate).
test("a pick's name passed as free text is not a second chip", async () => {
  const { dedupeChips, sameValue } = await import("./crewPicker.ts");
  const A = { kind: "team", id: "t1", name: "Team A" };
  // The panel's fallback: crew [Team A], team = the whole text "Team A".
  assert.deepEqual(crewChips([A], "Team A"), [A]);
  assert.deepEqual(crewChips([A, { kind: "worker", id: "w1", name: "Guru" }], "Team A + Guru + Ali"), [A, { kind: "worker", id: "w1", name: "Guru" }, "Ali"]);
  // Delete the pick: nothing comes back.
  assert.deepEqual(chipsToValue(crewChips([A], "Team A").filter((c) => typeof c === "string")), { crew: [], team: "" });
  // Typed duplicates (any case) are dropped; text is kept as typed.
  assert.deepEqual(chipsToValue([A, "team a", "Ali (lorry)", "ALI (LORRY)"]), { crew: [A], team: "Ali (lorry)" });
  assert.deepEqual(chipsToValue(["Team B", "team  b"]), { crew: [], team: "Team B" });
  assert.deepEqual(dedupeChips([A, { kind: "team", id: "t2", name: "team a" }]), [A]);
  assert.equal(crewDisplay([A], "Team A"), "Team A");
  // No change, no save.
  assert.equal(sameValue(chipsToValue(crewChips([A], "Team A")), { crew: [A], team: "" }), true);
  assert.equal(sameValue({ crew: [A], team: "" }, { crew: [], team: "" }), false);
});
