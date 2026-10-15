import type { GeneratedDoc } from "@/app/portal/shipments/_lib/api";

/** What every template form gets from the editor page (edits mark the draft dirty). */
export type DocFormProps<H, R> = {
  doc: GeneratedDoc;
  header: H;
  rows: R[];
  columns: any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  disabled: boolean;
  setHeader: (patch: Partial<H>) => void;
  setRows: (fn: (rows: R[]) => R[]) => void;
  setColumns: (fn: (cols: any[]) => any[]) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
};
