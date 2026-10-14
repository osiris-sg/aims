// Accounting Setup is hidden only for trade orgs: SHIPMENTS on and ACCOUNTING
// off (its page would otherwise create an empty accounting settings row).
// Every other org keeps it, because the page also holds document number
// formats and Tax Rates that Sales uses. Used by the sidebar, the top bar
// (useNavModules) and the page itself. Test: settingsVisibility.test.mjs.
export function showAccountingSetup(isModuleEnabled: (code: string) => boolean): boolean {
  return !(isModuleEnabled("SHIPMENTS") && !isModuleEnabled("ACCOUNTING"));
}
