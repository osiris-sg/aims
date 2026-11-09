// "Ask AIMEE" on a page (document editor, Finance Hub): open AIMEE in the side
// panel BESIDE the page, the way she shows a document on the right, never by
// leaving the page (guru 2026-11-09). The panel is mounted on every org with
// enableAimsChat (AimeeDockHost); pressing again folds it.

import { toggleDock } from "@/app/portal/shipments/_components/aimee/bridge";

export function launchAimee() {
  toggleDock();
}
