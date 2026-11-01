// Run: npm test. Round AZ: every message key exists in both English and Japanese, with the same {placeholders}.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const dir = new URL("../i18n/messages/", import.meta.url);
const flat = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (typeof v === "object" && v ? flat(v, `${p}${k}.`) : [[`${p}${k}`, String(v)]]));
const args = (s) => [...new Set([...s.matchAll(/\{(\w+)/g)].map((m) => m[1]))].filter((x) => !["plural", "select", "other", "one"].includes(x)).sort().join(",");

for (const file of readdirSync(new URL("en/", dir))) {
  test(`${file}: same keys and placeholders in en and ja`, () => {
    const en = new Map(flat(JSON.parse(readFileSync(new URL(`en/${file}`, dir), "utf8"))));
    const ja = new Map(flat(JSON.parse(readFileSync(new URL(`ja/${file}`, dir), "utf8"))));
    assert.deepEqual([...en.keys()].filter((k) => !ja.has(k)), [], "missing in ja");
    assert.deepEqual([...ja.keys()].filter((k) => !en.has(k)), [], "missing in en");
    for (const [k, v] of en) assert.equal(args(ja.get(k)), args(v), `placeholders differ: ${k}`);
  });
}
