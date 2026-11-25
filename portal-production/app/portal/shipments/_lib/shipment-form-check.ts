// Round BY (Sayaka, #24): what stops the B/L details form from saving — one list, so Save never fails silently.
// A contract is needed only to CREATE a shipment outside an order; an existing shipment (or one under an order,
// e.g. a PI-only order like #24 with SIAE) saves without one. ETA before ETD stays a field warning only (as before).

export type FormProblem = { key: "contract" | "productLine" | "currency" | "deliveryMonth" | "dates" | "number"; field?: string };

export function formProblems(x: {
  creating: boolean;
  underOrder: boolean;
  contractId: string;
  lineRequired: boolean;
  lineId: string;
  currency: string;
  deliveryMonth: string;
  dateError: boolean;
  badNumbers: string[];
}): FormProblem[] {
  const out: FormProblem[] = [];
  if (x.creating && !x.underOrder && !x.contractId) out.push({ key: "contract" });
  if (x.lineRequired && !x.lineId) out.push({ key: "productLine" });
  if (!/^[A-Z]{3}$/.test(x.currency.trim())) out.push({ key: "currency" });
  if (x.deliveryMonth.trim() !== "" && !/^\d{4}-(0[1-9]|1[0-2])$/.test(x.deliveryMonth.trim())) out.push({ key: "deliveryMonth" });
  if (x.dateError) out.push({ key: "dates" });
  for (const f of x.badNumbers) out.push({ key: "number", field: f });
  return out;
}
