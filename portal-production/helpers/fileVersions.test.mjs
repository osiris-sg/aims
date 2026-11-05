// Round BF — file version badges (pure helpers).
import { test } from "node:test";
import assert from "node:assert/strict";
import { compareWith, dmHm, factsLine, olderVersion, versionBadges, versionKey } from "../app/portal/shipments/_lib/file-versions.ts";

test("dmHm is day/month and time in Japan", () => {
  assert.equal(dmHm("2026-11-05T05:02:00Z"), "5/11 14:02");
  assert.equal(dmHm("2026-10-26T12:36:32Z"), "26/10 21:36");
  assert.equal(dmHm(null), "");
  assert.equal(dmHm("2026-11-05T05:02:00Z", "ja"), "11/5 14:02");
});

test("badges: Latest / Older version / Identical to", () => {
  assert.deepEqual(versionBadges(null), []);
  assert.deepEqual(versionBadges({ versions: 1, latest: true, olderAt: null, identicalTo: null }), []);
  assert.deepEqual(versionBadges({ versions: 3, latest: true, olderAt: null, identicalTo: null }), [{ kind: "latest", at: "" }]);
  assert.deepEqual(versionBadges({ versions: 3, latest: false, olderAt: "2026-10-26T12:36:32Z", identicalTo: { emailId: "e", index: 0, name: "x.pdf", date: "2026-10-27T04:10:49Z" } }), [
    { kind: "older", at: "26/10 21:36" },
    { kind: "identical", at: "27/10 13:10" },
  ]);
  assert.deepEqual(versionBadges({ versions: 2, latest: false, olderAt: "2026-10-26T12:36:32Z", identicalTo: null }, "ja"), [{ kind: "older", at: "10/26 21:36" }]);
});

test("older versions default to Don't file; the latest is filed", () => {
  assert.equal(olderVersion({ versions: 3, latest: false, olderAt: "x", identicalTo: null }), true);
  assert.equal(olderVersion({ versions: 3, latest: true, olderAt: null, identicalTo: null }), false);
  assert.equal(olderVersion(null), false);
});

test("facts line and compare partner", () => {
  assert.equal(factsLine(214768, 2, (n) => `${Math.round(n / 1024)} KB`, (n) => `${n} pages`), "210 KB · 2 pages");
  assert.equal(factsLine(null, null, String, String), "");
  const v = (latest) => ({ versions: 2, latest, olderAt: null, identicalTo: null });
  const a = { emailId: "a", index: 0, name: "198GX07112 BLCopyView (1).pdf", date: "2026-10-26T07:31:51Z", version: v(false) };
  const b = { emailId: "b", index: 0, name: "198GX07112 BLCopyView (1).pdf", date: "2026-10-27T04:10:49Z", version: v(true) };
  const same = (x, y) => versionKey(x.name) === versionKey(y.name);
  assert.equal(compareWith(a, [a, b], same), b);
  assert.equal(compareWith(b, [a, b], same), a);
  assert.equal(versionKey("198GX07112 BLCopyView (2).PDF"), versionKey("198gx07112 BLCopyView.pdf"));
});
