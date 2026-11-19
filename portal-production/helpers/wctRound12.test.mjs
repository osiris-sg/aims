// WCT round 12 (Richie, 2026-11-19): calendar Salesperson label, the order page's one Service report menu,
// upload file types, the Showing page size, and the vehicle Money spent card.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clientPage } from "./clientPaging.ts";
import { ORDER_FILE_ACCEPT, REPORT_FILE_ACCEPT, acceptLabel, orderUploadTip, serviceReportMenuItems } from "./serviceReportFlow.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// 1. Jobs calendar: the Salesperson filter (round 12 fixed its label) was removed 2026-11-19; the people list
// beside the calendar does this job.
test("calendar Salesperson filter is gone (people list instead)", () => {
  const src = read("components/Dashboard/JobsCalendar.tsx");
  assert.doesNotMatch(src, /jc-salesperson-label|showSalesFilter|salesFilter/);
  assert.match(src, /filterByPeople/);
});

// 2b. One Service report button; the menu keeps every old path.
test("service report menu: New / Upload file / Link existing on the manual flow; Upload file / Link existing otherwise", () => {
  assert.deepEqual(serviceReportMenuItems(true).map((i) => i.label), ["New", "Upload file", "Link existing"]);
  assert.deepEqual(serviceReportMenuItems(false).map((i) => i.label), ["Upload file", "Link existing"]);
  assert.deepEqual(serviceReportMenuItems(true).map((i) => i.tour), ["wct-order-new-report", "wct-order-upload-report", "wct-order-link-report"]);
});

test("order page: one Service report button, wired to the old flows", () => {
  const src = read("app/portal/orders/[id]/WctOrderDetail.tsx");
  assert.doesNotMatch(src, />\s*Add service report\s*</);
  assert.doesNotMatch(src, />\s*Link a service report\s*<\/Button>/);
  assert.match(src, /data-tour="wct-order-add-report"\s*>\s*Service report\s*<\/Button>/);
  assert.match(src, /serviceReportMenuItems\(manualFlow\)/);
  // manual flow: New / Upload go to the Service Reports page's flows; otherwise Upload stores on the order; Link opens the dialog.
  assert.match(src, /if \(it\.key === "new" \|\| \(it\.key === "upload" && manualFlow\)\) router\.push\(serviceReportFlowHref\(it\.key, srPrefillFor\(doId\)\)\);/);
  assert.match(src, /else if \(it\.key === "upload"\) fileRef\.current\?\.click\(\);/);
  assert.match(src, /else void openLink\(\);/);
  assert.match(src, /accept={ORDER_FILE_ACCEPT}/);
  // The Link dialog itself is unchanged.
  assert.match(src, /<DialogTitle>Link a service report<\/DialogTitle>/);
});

// 3. The file types, the same on the picker and the API.
test("service report upload types: the picker list equals the API's MIME_EXT", () => {
  const api = read("../api-server-production/src/maintenance-reports/uploaded-report.ts");
  const mimeExt = api.slice(api.indexOf("const MIME_EXT"), api.indexOf("};", api.indexOf("const MIME_EXT")));
  const apiTypes = [...mimeExt.matchAll(/'([a-z]+\/[a-z.+-]+)'/g)].map((m) => m[1]);
  assert.deepEqual([...REPORT_FILE_ACCEPT.split(",")].sort(), [...apiTypes].sort());
  assert.equal(acceptLabel(REPORT_FILE_ACCEPT), "PDF, JPG, PNG, WEBP or GIF");
  assert.equal(ORDER_FILE_ACCEPT, "application/pdf,image/*");
  assert.equal(orderUploadTip(true), "PDF, JPG, PNG, WEBP or GIF");
  assert.equal(orderUploadTip(false), "PDF or any image");
  assert.match(read("app/portal/maintenance-reports/_components/PhotosFileControls.tsx"), /import \{ REPORT_FILE_ACCEPT \} from "@\/helpers\/serviceReportFlow";/);
});

test("Service Reports upload dialog: the types tooltip only for WCT orders orgs (empty title = no tooltip elsewhere)", () => {
  const src = read("app/portal/maintenance-reports/_components/UploadServiceReportDialog.tsx");
  assert.match(src, /<Tooltip title={wctOrders \? acceptLabel\(REPORT_FILE_ACCEPT\) : ""} placement="top">/);
  assert.match(src, /accept={REPORT_FILE_ACCEPT}/);
});

// 4. Showing 10 / 20 / 50 / 100.
test("client paging slices, clamps and counts", () => {
  const rows = Array.from({ length: 64 }, (_, i) => i + 1);
  assert.deepEqual(clientPage(rows, 1, 10).rows, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(clientPage(rows, 1, 10).pageCount, 7);
  assert.deepEqual(clientPage(rows, 2, 20), { rows: rows.slice(20, 40), page: 2, pageCount: 4, total: 64, from: 21, to: 40 });
  assert.equal(clientPage(rows, 1, 50).rows.length, 50);
  // A bigger page size leaves page 4 past the end: back to the last page.
  assert.equal(clientPage(rows, 4, 100).page, 1);
  assert.deepEqual(clientPage([], 1, 10), { rows: [], page: 1, pageCount: 1, total: 0, from: 0, to: 0 });
});

test("PageTable: every row it is handed is rendered (no hidden 30-row cap); client-paged lists opt in", () => {
  const pt = read("components/PageTable.tsx");
  assert.match(pt, /showAllRows={!sliced}/);
  assert.match(pt, /clientPage={sliced \? \{ index: sliced\.page - 1, size: limit \?\? DEFAULT_PAGE_SIZE \} : undefined}/);
  const table = read("components/Table.tsx");
  assert.match(table, /if \(manualSorting \|\| showAllRows\) \{/);
  assert.match(table, /pagination: clientPage \? \{ pageIndex: clientPage\.index, pageSize: Math\.max\(clientPage\.size, 1\) \} : pagination,/);
  // Table used outside PageTable keeps its old behaviour (default false, no clientPage).
  assert.match(table, /showAllRows = false, clientPage \} = props;/);
  for (const f of [
    "app/portal/orders/WctOrdersList.tsx",
    "app/portal/orders/SlimOrdersList.tsx",
    "app/portal/orders/CappitechOrdersList.tsx",
    "app/portal/assets/vehicles/page.tsx",
    "app/portal/shipments/books/_components/ChartView.tsx",
    "app/portal/shipments/books/_components/FxRatesView.tsx",
  ]) assert.match(read(f), /\n\s*clientPaging\n/, f);
});

// 6. Vehicles: an empty period shows just S$0.00.
test("vehicle Money spent: no Nothing spent line", () => {
  const col = read("app/portal/assets/vehicles/_components/MoneyColumn.tsx");
  assert.doesNotMatch(col, /Nothing spent/);
  assert.match(col, /\{fmtMoney\(p\.total\)\}/);
  assert.doesNotMatch(read("app/portal/assets/vehicles/[id]/page.tsx"), /Nothing spent/);
});

// 2026-11-19 (WCT group): the quotation toolbar's "Go to order ORD…" is gone; the editor page's banner
// ("Order ORD… created · Open order", shown on every open of a quotation with an order) stays.
test("quotation: no Go to order toolbar button; the order banner stays", () => {
  const editor = read("containers/DocumentTemplates/components/TabbedDocumentCreator.tsx");
  assert.doesNotMatch(editor, /Go to order \{/);
  assert.doesNotMatch(editor, /editor-go-to-order/);
  const page = read("app/portal/documents/[type]/[id]/[documentId]/page.tsx");
  assert.match(page, /Order \{linkedOrder\.orderNumber\} created/);
  assert.match(page, /Open order/);
});
