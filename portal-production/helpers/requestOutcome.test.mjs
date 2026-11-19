// Run: npm test (node --test). Round 16 (all orgs): a failed request() never reads as a success, and a failed
// list never crashes its screen. Unit tests for helpers/requestOutcome.ts plus static checks of the fixed screens.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { failureLine, failureText, listFrom, replyBody, requestFailed } from "./requestOutcome.ts";
import { TIMED_OUT_TEXT } from "./apiErrorToast.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");

// ── unit ──
test("requestFailed: only request()'s failure shape; a 204 / empty / ordinary reply is not a failure", () => {
  assert.equal(requestFailed({ success: false, message: "Nope" }), true);
  for (const ok of [undefined, null, "", 0, [], {}, { success: true }, { data: [] }, { id: "x" }]) assert.equal(requestFailed(ok), false, JSON.stringify(ok));
});

test("failureText / failureLine: the API's reason in plain words, else the fallback", () => {
  assert.equal(failureText({ success: false, message: "Account is locked" }, "x"), "Account is locked");
  assert.equal(failureText({ success: false, message: ["a is required", "b must be a number"] }, "x"), "a is required; b must be a number");
  assert.equal(failureText({ success: false, message: "Request timed out — please try again.", timedOut: true }, "x"), TIMED_OUT_TEXT);
  assert.equal(failureText({ success: false }, "Could not save"), "Could not save");
  assert.equal(failureText({ success: true }, "Could not save"), "Could not save");
  assert.equal(failureLine({ success: false, message: "Internal server error" }, "Could not load the receipt list"), "Could not load the receipt list. Internal server error");
  assert.equal(failureLine({ success: false }, "Could not load the receipt list"), "Could not load the receipt list");
  assert.ok(!/[—…]/.test(failureLine({ success: false, message: "A — B" }, "X")));
});

test("listFrom: a failure gives no rows and an error, never the failure object (the crash)", () => {
  const failed = listFrom({ success: false, message: "Boom" }, "Could not load the voucher list");
  assert.deepEqual(failed, { rows: [], error: "Could not load the voucher list. Boom" });
  assert.ok(Array.isArray(failed.rows)); // .filter / .map on it can never throw
});

test("listFrom: success shapes (wrapped, bare, picked) and odd shapes", () => {
  assert.deepEqual(listFrom({ success: true, data: [{ id: 1 }] }, "x"), { rows: [{ id: 1 }], error: null });
  assert.deepEqual(listFrom([{ id: 2 }], "x"), { rows: [{ id: 2 }], error: null });
  assert.deepEqual(listFrom({ success: true, data: { docs: [{ id: 3 }] } }, "x", (b) => b.docs), { rows: [{ id: 3 }], error: null });
  for (const odd of [undefined, null, "", { success: true }, { data: { nope: 1 } }, { data: null }]) assert.deepEqual(listFrom(odd, "x"), { rows: [], error: null });
  assert.deepEqual(listFrom({ data: {} }, "x", (b) => b.missing.deep), { rows: [], error: null }); // a throwing pick
  assert.deepEqual(replyBody({ success: true, data: [1] }), [1]);
  assert.deepEqual(replyBody([1]), [1]);
});

// ── static: "failure = no success message" at each fixed site ──
/** The code from a request() call whose first argument contains `marker` to the next `after`; and its result variable. */
function segment(file, marker, after) {
  const src = read(file);
  const at = src.indexOf(marker);
  assert.ok(at > 0, `${file}: request for ${marker} not found`);
  const call = src.lastIndexOf("request(", at);
  const head = src.slice(Math.max(0, call - 60), call);
  const v = /(?:const|let)\s+(\w+)(?::\s*\w+)?\s*=\s*await\s+$/.exec(head)?.[1];
  assert.ok(v, `${file}: the result of the ${marker} call is not kept, so it cannot be checked`);
  const end = src.indexOf(after, at);
  assert.ok(end > at, `${file}: "${after}" not found after ${marker}`);
  return { v, code: src.slice(at, end) };
}

const SITES = [
  ["app/portal/projects/[id]/page.tsx", "/off-hire`", 'toast.success("Deployment off-hired")', "Project: Off-hire"],
  ["app/portal/projects/[id]/page.tsx", "/convert-to-sale`", "toast.success(", "Project: Convert to sale"],
  ["app/portal/admin/organizations/[id]/ApiKeysTab.tsx", "path: `${base}/${row.id}`, method: \"PATCH\"", "toast.success(", "API key: auto-post toggle"],
  ["app/portal/admin/organizations/[id]/ApiKeysTab.tsx", "/revoke`, method: \"POST\"", 'toast.success("Key revoked")', "API key: revoke"],
  ["app/portal/admin/organizations/[id]/ApiKeysTab.tsx", "{ path: base, method: \"POST\" }", "setMintedKey(", "API key: generate (form cleared)"],
  ["app/portal/admin/organizations/[id]/TemplateDesignDialog.tsx", "/design`, method: \"POST\"", 'toast.success("Design saved")', "Template design: save"],
  ["app/portal/settings/business-rules/page.tsx", 'path: "/org-rules"', "toast.success(", "Business rules: save"],
  ["app/portal/user-management/users/components/TeamsPanel.tsx", 'method: "PATCH", path: "/teams/:id"', "setDialogOpen(false)", "Teams: edit"],
  ["app/portal/user-management/users/components/TeamsPanel.tsx", 'method: "POST", path: "/teams" }', "setDialogOpen(false)", "Teams: create"],
  ["app/portal/user-management/users/components/TeamsPanel.tsx", 'path: "/teams/:id/members"', "setDialogOpen(false)", "Teams: members"],
  ["app/portal/user-management/users/components/TeamsPanel.tsx", 'method: "DELETE", path: "/teams/:id"', "setDeleting(null)", "Teams: delete"],
  ["app/portal/user-management/users/components/EditUser.tsx", "/profile`", "onClose()", "User: profile save"],
  ["app/portal/accounting/bills/_components/RecordBillPaymentDialog.tsx", "/payments`", 'toast.success("Payment recorded")', "Bill: record payment"],
  ["containers/DocumentTemplates/components/TabbedDocumentCreator.tsx", "`/receipts/${docId}`, method: \"DELETE\"", "toast.success(", "Delete receipt / PV / JV"],
  ["containers/DocumentTemplates/components/TabbedDocumentCreator.tsx", "/delivery-share-link/revoke`", 'toast.success("Delivery link revoked")', "Revoke delivery link"],
  ["containers/DocumentTemplates/components/TabbedDocumentCreator.tsx", "/share-link/revoke`", 'toast.success("DO link revoked")', "Revoke DO link"],
  ["containers/DocumentTemplates/components/TabbedDocumentCreator.tsx", "/bulk-complete-do`", 'toast.success("Delivery order completed")', "Bulk complete DO"],
  ["containers/DocumentTemplates/components/RouteOrderPointsEditor.tsx", 'method: "PATCH" }', "toast.success(", "Points balance: set"],
];

for (const [file, marker, after, label] of SITES) {
  test(`failure = no success: ${label}`, () => {
    const { v, code } = segment(file, marker, after);
    assert.match(code, new RegExp(`if \\(requestFailed\\(${v}\\)\\)\\s*(return|throw|\\{)`), `${file}: no failure check on ${v} before ${after}`);
  });
}

test("failure = no success: the user profile failure is the drawer's own error (ownError), not two errors", () => {
  const src = read("app/portal/user-management/users/components/EditUser.tsx");
  assert.match(src, /path: `\/users\/\$\{user\.id\}\/profile`, ownError: true/);
  assert.match(src, /if \(requestFailed\(profileRes\)\) throw new Error/);
});

// ── static: failed loads show an error with a Retry, never crash ──
const LOADS = [
  ["app/portal/admin/organizations/[id]/ApiKeysTab.tsx", /setRows\(res\?\.data \?\? res/],
  ["app/portal/accounting/journal-vouchers/[documentId]/page.tsx", /setVouchers\(unwrap\(list\)/],
  ["app/portal/accounting/payment-vouchers/[documentId]/page.tsx", /setVouchers\(unwrap\(listRes\)/],
  ["app/portal/accounting/receipts/[documentId]/page.tsx", /setReceipts\(unwrap\(listRes\)/],
  ["app/portal/documents/create/hooks/useGetDocumentTemplates.tsx", /setDocumentTemplates\(response\.data\)/],
];
for (const [file, crash] of LOADS) {
  test(`failed load never reaches state as rows: ${file}`, () => {
    const src = read(file);
    assert.doesNotMatch(src, crash);
    assert.match(src, /listFrom|requestFailed/);
  });
}

test("failed loads show LoadErrorAlert with a Retry", () => {
  for (const f of [
    "app/portal/admin/organizations/[id]/ApiKeysTab.tsx",
    "app/portal/accounting/journal-vouchers/[documentId]/page.tsx",
    "app/portal/accounting/payment-vouchers/[documentId]/page.tsx",
    "app/portal/accounting/receipts/[documentId]/page.tsx",
    "app/portal/documents/create/page.tsx",
    "app/portal/documents/edit/[type]/[id]/page.tsx",
  ]) assert.match(read(f), /<LoadErrorAlert message=\{\w+\} onRetry=\{/, f);
  assert.match(read("components/LoadErrorAlert.tsx"), />\s*Retry\s*</);
});

// ── static: request()'s first argument is always the meta object (the documents/edit bug) ──
const walk = (d, out = []) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) {
      if (n !== "node_modules" && n !== ".next") walk(p, out);
    } else if (/\.(ts|tsx)$/.test(n)) out.push(p);
  }
  return out;
};

test("request() is never called with a URL string as its first argument (it would always fail)", () => {
  const bad = [];
  for (const f of ["app", "components", "containers", "hooks", "i18n"].flatMap((d) => walk(join(ROOT, d)))) {
    const src = readFileSync(f, "utf8");
    if (!/import\s*\{[^}]*\brequest\b[^}]*\}\s*from\s*["'][^"']*helpers\/request["']/.test(src)) continue;
    const re = /(?<![.\w])request\s*\(\s*([`'"])/g;
    let m;
    while ((m = re.exec(src))) bad.push(`${relative(ROOT, f)}:${src.slice(0, m.index).split("\n").length}`);
  }
  assert.deepEqual(bad, []);
});

test("documents/edit/[type]/[id] (template editor) loads and saves through valid calls", () => {
  const src = read("app/portal/documents/edit/[type]/[id]/page.tsx");
  assert.match(src, /request\(\{ path: `\/documentTemplates\/\$\{id\}`, method: "GET", ownError: true \}/);
  assert.match(src, /\{ path: "\/documentTemplates\/update", method: "POST" \}/);
  assert.match(src, /if \(requestFailed\(response\)\) throw/);
});

test("the email ingestion log opens created documents by id, not through the template editor", () => {
  const src = read("app/portal/admin/organizations/[id]/EmailIngestionTab.tsx");
  assert.doesNotMatch(src, /\/portal\/documents\/edit\//);
  assert.match(src, /`\/portal\/documents\/open\/\$\{id\}`/);
});
