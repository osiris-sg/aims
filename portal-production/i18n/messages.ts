// Round AZ — the portal's message catalogs: one English base file and one Japanese file per area. Japanese falls
// back to English key by key (a missing Japanese string shows in English, never as a raw key).
import type { UiLang } from "./lang";
import enCommon from "./messages/en/common.json";
import jaCommon from "./messages/ja/common.json";
import enShell from "./messages/en/shell.json";
import jaShell from "./messages/ja/shell.json";
import enSteps from "./messages/en/steps.json";
import jaSteps from "./messages/ja/steps.json";
import enShipments from "./messages/en/shipments.json";
import jaShipments from "./messages/ja/shipments.json";
import enClients from "./messages/en/clients.json";
import jaClients from "./messages/ja/clients.json";
import enSettings from "./messages/en/settings.json";
import jaSettings from "./messages/ja/settings.json";
import enUsers from "./messages/en/users.json";
import jaUsers from "./messages/ja/users.json";
import enAudit from "./messages/en/audit.json";
import jaAudit from "./messages/ja/audit.json";
import enInvoices from "./messages/en/invoices.json";
import jaInvoices from "./messages/ja/invoices.json";
import enOrders from "./messages/en/orders.json";
import jaOrders from "./messages/ja/orders.json";
import enInbox from "./messages/en/inbox.json";
import jaInbox from "./messages/ja/inbox.json";
import enContracts from "./messages/en/contracts.json";
import jaContracts from "./messages/ja/contracts.json";
import enCatalog from "./messages/en/catalog.json";
import jaCatalog from "./messages/ja/catalog.json";
import enAddflow from "./messages/en/addflow.json";
import jaAddflow from "./messages/ja/addflow.json";
import enSi from "./messages/en/si.json";
import jaSi from "./messages/ja/si.json";

type Tree = { [k: string]: string | Tree };
const EN: Tree = { common: enCommon, shell: enShell, steps: enSteps, shipments: enShipments, clients: enClients, settings: enSettings, users: enUsers, audit: enAudit, invoices: enInvoices, orders: enOrders, inbox: enInbox, contracts: enContracts, catalog: enCatalog, addflow: enAddflow, si: enSi } as Tree;
const JA: Tree = { common: jaCommon, shell: jaShell, steps: jaSteps, shipments: jaShipments, clients: jaClients, settings: jaSettings, users: jaUsers, audit: jaAudit, invoices: jaInvoices, orders: jaOrders, inbox: jaInbox, contracts: jaContracts, catalog: jaCatalog, addflow: jaAddflow, si: jaSi } as Tree;

/** English under Japanese, key by key. */
export function withFallback(base: Tree, over: Tree): Tree {
  const out: Tree = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = typeof v === "object" && typeof base[k] === "object" ? withFallback(base[k] as Tree, v) : v;
  return out;
}

const JA_FULL = withFallback(EN, JA);
export const messagesFor = (lang: UiLang): Tree => (lang === "ja" ? JA_FULL : EN);
