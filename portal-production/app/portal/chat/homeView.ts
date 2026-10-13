// Which home the portal landing page shows for a chat-first org: the chat
// assistant or the classic dashboard. Per browser, remembered in localStorage.
export type HomeView = "chat" | "dashboard";
export const HOME_VIEW_KEY = "aims:home-view";
export const HOME_VIEW_EVENT = "aims:home-view-change";

export function writeHomeView(v: HomeView) {
  try {
    window.localStorage.setItem(HOME_VIEW_KEY, v);
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new Event(HOME_VIEW_EVENT));
}

export function readHomeView(): HomeView {
  try {
    return window.localStorage.getItem(HOME_VIEW_KEY) === "dashboard" ? "dashboard" : "chat";
  } catch {
    return "chat";
  }
}
