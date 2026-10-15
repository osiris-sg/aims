// Accounting Setup is hidden only for trade orgs: SHIPMENTS on and ACCOUNTING
// off (its page would otherwise create an empty accounting settings row).
// Every other org keeps it, because the page also holds document number
// formats and Tax Rates that Sales uses. Used by the sidebar, the top bar
// (useNavModules) and the page itself. Test: settingsVisibility.test.mjs.
export function showAccountingSetup(isModuleEnabled: (code: string) => boolean): boolean {
  return !(isModuleEnabled("SHIPMENTS") && !isModuleEnabled("ACCOUNTING"));
}

// "Shipping & documents" (B/L defaults, document texts, banks, seal, delivery
// profiles, QMJP by quarter, SI 宛先) only for orgs with the SHIPMENTS module.
export function showShippingSettings(isModuleEnabled: (code: string) => boolean): boolean {
  return isModuleEnabled("SHIPMENTS");
}

// A module can be kept ON (its routes, data and permissions keep working) but
// left out of the menus: config.hideInMenu, set per org by its setup script
// (ADH Japan: SALES — trade invoices are stored as Sales invoices, but the
// team works from Invoices / Shipments). Used by the sidebar and the top bar.
export function shownInMenu(module: { config?: unknown } | null | undefined): boolean {
  return !(module?.config && (module.config as { hideInMenu?: boolean }).hideInMenu === true);
}
