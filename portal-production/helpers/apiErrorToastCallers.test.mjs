// Run: npm test (node --test). No double errors (portal-wide error toast, helpers/apiErrorToast.ts).
// A request() call whose own failure branch shows an error right away (`if (!res.success) toast.error(...)`,
// `res?.success === false` → setError / alert / enqueueSnackbar) must pass `ownError: true` (or `quiet: true`),
// or the screen would show its error twice. Static scan of the portal's source, so new code is held to it too.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
// /portal code only: the toast never shows on field, guest or public pages.
const DIRS = ["app/portal", "components", "containers", "hooks", "i18n"];
const walk = (d, out = []) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) {
      if (n !== "node_modules" && n !== ".next") walk(p, out);
    } else if (/\.(ts|tsx)$/.test(n)) out.push(p);
  }
  return out;
};
const IMPORT = /import\s*\{([^}]*)\}\s*from\s*["'][^"']*helpers\/request["']/;
const DISPLAY = /\b(toast\s*\.\s*(error|warn|warning)|enqueueSnackbar|alert|setError|set[A-Z]\w*Error|showNotification|showError)\s*\(/;

/** Every request() call in the portal: file, line, the variable holding its result, its first argument, the next lines. */
function requestCalls() {
  const calls = [];
  for (const f of DIRS.flatMap((d) => walk(join(ROOT, d)))) {
    const src = readFileSync(f, "utf8");
    const m = IMPORT.exec(src);
    if (!m) continue;
    const fns = m[1]
      .split(",")
      .map((s) => s.trim())
      .filter((s) => /^request\b/.test(s))
      .map((s) => / as (\w+)/.exec(s)?.[1] ?? "request");
    if (!fns.length) continue;
    const callRe = new RegExp(`(?<![.\\w])(${fns.join("|")})\\s*\\(`, "g");
    let x;
    while ((x = callRe.exec(src))) {
      const at = x.index;
      const before = src.slice(Math.max(0, at - 80), at);
      const v = /(?:const|let|var)\s+(\w+)\s*(?::\s*\w+)?\s*=\s*(?:await\s+)?$/.exec(before)?.[1] ?? /(\w+)\s*=\s*(?:await\s+)?$/.exec(before)?.[1];
      const open = src.indexOf("{", at);
      let depth = 0;
      let end = open;
      for (; end < src.length; end++) {
        if (src[end] === "{") depth++;
        else if (src[end] === "}" && --depth === 0) break;
      }
      calls.push({
        file: relative(ROOT, f),
        line: src.slice(0, at).split("\n").length,
        v,
        meta: src.slice(at, end + 1),
        after: src.slice(at).split("\n").slice(0, 10).join("\n"),
      });
    }
  }
  return calls;
}

// Calls the scan reads as "shows its own error" that do not: the error state is never rendered.
const NOT_SHOWN = {
  "app/portal/components/GoToLatestDocument.tsx": "`const [, setError]`: the error is stored, never rendered",
};

const flagged = (meta) => /\bownError\s*:\s*true\b|\bquiet\b/.test(meta);

/** The call's failure branch shows an error within a few lines (the common shape; a guard, not a proof of absence). */
function showsOwnErrorRightAway(c) {
  if (!c.v) return false;
  const v = c.v;
  const fail = new RegExp(`(!\\s*${v}\\??\\.success\\b|${v}\\??\\.success\\s*===\\s*false|!${v}\\b\\s*\\|\\|\\s*!?${v}\\??\\.success|${v}\\??\\.success\\s*!==\\s*true)`);
  const fm = fail.exec(c.after);
  if (!fm) return false;
  return DISPLAY.test(c.after.slice(fm.index).split("\n").slice(0, 4).join("\n"));
}

test("the scan finds the portal's request() calls", () => {
  assert.ok(requestCalls().length > 400);
});

test("every request() call that shows its own error right away passes ownError (no double error)", () => {
  const own = requestCalls().filter(showsOwnErrorRightAway);
  assert.ok(own.length > 10, `expected the common own-error shape to be found, got ${own.length}`);
  const missing = own.filter((c) => !flagged(c.meta) && !NOT_SHOWN[c.file]).map((c) => `${c.file}:${c.line}`);
  assert.deepEqual(missing, []);
});

test("flags sit in request()'s first argument, the only place request() reads them", () => {
  const misplaced = requestCalls()
    .filter((c) => /\bownError\b/.test(c.after.split("\n")[0]) && !/\bownError\b/.test(c.meta))
    .map((c) => `${c.file}:${c.line}`);
  assert.deepEqual(misplaced, []);
});
