// Locate Customer dialog layout (task D, 2026-11-17). enableCustomerUen orgs
// (the WCT group) get a UEN column after Company Name, the subline under the
// name keeps only the old code, and the two hint lines are dropped. Every
// other org gets exactly the layout it had.
import { customerIdsLine } from "./customerIds";

export type PickerColumn = { key: "code" | "name" | "uen" | "phone" | "email"; label: string; width: string };

const LEGACY: PickerColumn[] = [
  { key: "code", label: "Customer Code", width: "20%" },
  { key: "name", label: "Company Name", width: "40%" },
  { key: "phone", label: "Phone", width: "20%" },
  { key: "email", label: "Email", width: "20%" },
];

const WITH_UEN: PickerColumn[] = [
  { key: "code", label: "Customer Code", width: "15%" },
  { key: "name", label: "Company Name", width: "35%" },
  { key: "uen", label: "UEN", width: "15%" },
  { key: "phone", label: "Phone", width: "15%" },
  { key: "email", label: "Email", width: "20%" },
];

export function customerPickerLayout(uenOn: boolean) {
  return {
    columns: uenOn ? WITH_UEN : LEGACY,
    showHints: !uenOn,
    subline: (c: { uen?: string | null; externalRef?: string | null }) => customerIdsLine(c, { withUen: !uenOn }),
  };
}
