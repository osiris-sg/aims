// Multi-organisation users: helpers/multiOrg.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { memberOverride, pushOrgSwitch, pushTitle, needsFieldOrgPick } from "./multiOrg.ts";

test("memberOverride: only one of my orgs, never the default, never someone else's", () => {
  assert.equal(memberOverride("b", "a", ["a", "b"]), "b");
  assert.equal(memberOverride("a", "a", ["a", "b"]), null);
  assert.equal(memberOverride("c", "a", ["a", "b"]), null);
  assert.equal(memberOverride(null, "a", ["a", "b"]), null);
});

test("pushOrgSwitch: tapping a push of another of my orgs switches there", () => {
  assert.equal(pushOrgSwitch({ orgId: "b" }, "a", ["a", "b"]), "b");
  assert.equal(pushOrgSwitch({ orgId: "a" }, "a", ["a", "b"]), null);
  assert.equal(pushOrgSwitch({ orgId: "c" }, "a", ["a", "b"]), null);
  assert.equal(pushOrgSwitch({}, "a", ["a"]), null);
});

test("pushTitle: names the org only when it is not the one on screen", () => {
  assert.equal(pushTitle("New job", { orgId: "b", orgName: "WCT Racking" }, "a"), "[WCT Racking] New job");
  assert.equal(pushTitle("New job", { orgId: "a", orgName: "WCT" }, "a"), "New job");
  assert.equal(pushTitle("New job", undefined, "a"), "New job");
});

test("needsFieldOrgPick: 2+ orgs and not picked this session", () => {
  assert.equal(needsFieldOrgPick(2, false), true);
  assert.equal(needsFieldOrgPick(2, true), false);
  assert.equal(needsFieldOrgPick(1, false), false);
});
