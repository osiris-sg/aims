// AIMEE open or closed. The dashboard is the landing page; AIMEE sits on top
// of it and opens over it when pressed (guru 2026-10-15). Not persisted: a
// reload lands on the dashboard unless the URL names a conversation
// (?chat=<id>) or asks for AIMEE (?aimee=1).
export type HomeView = "aimee" | "dashboard";
export const HOME_VIEW_EVENT = "aims:home-view-change";

export interface AimeeOpenDetail {
  view: HomeView;
  /** Viewport point the reveal grows from (the face that was pressed). */
  x?: number;
  y?: number;
  /** Text to send as the first message once AIMEE is open. */
  prompt?: string;
  /** Open without the reveal animation (deep links). */
  instant?: boolean;
}

let current: HomeView = "dashboard";

function emit(detail: AimeeOpenDetail) {
  current = detail.view;
  window.dispatchEvent(new CustomEvent<AimeeOpenDetail>(HOME_VIEW_EVENT, { detail }));
}

export function openAimee(detail: Omit<AimeeOpenDetail, "view"> = {}) {
  emit({ view: "aimee", ...detail });
}

export function closeAimee() {
  emit({ view: "dashboard" });
}

export function writeHomeView(v: HomeView) {
  if (v === "aimee") openAimee();
  else closeAimee();
}

export function readHomeView(): HomeView {
  return current;
}
