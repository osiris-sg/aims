"use client";

// Round BL — the bridge between the Shipments pages and AIMEE (no React state of its own, so any page can use it):
//   - the page context: what the user is looking at (the order / shipment, the open step, the email card or file).
//     Pages publish it in layers (page < email < dialog: the top-most one wins) and the AIMEE side panel shows it in
//     its header and sends it with each message. It is data for the assistant, never instructions.
//   - the aimee payload builder: registered by the side panel's host only on an org with the SHIPMENTS module and
//     AIMEE on, so useOperatorChat sends `aimee` for those orgs and nothing changes for every other org;
//   - the side panel's open / close / prompt events and the walkthrough start (GuideHost runs it).

import { useSyncExternalStore } from "react";

export interface AimeeStep {
  id?: string | null;
  code?: string | null;
  no?: string | null;
  title?: string | null;
}

export interface AimeePageCtx {
  path?: string | null;
  /** "#18-1" / "#18". */
  ref?: string | null;
  orderId?: string | null;
  shipmentId?: string | null;
  step?: AimeeStep | null;
  email?: { id: string; subject?: string | null } | null;
  file?: { id?: string | null; name?: string | null } | null;
  /** "Dashboard", "Answer", "Orders". */
  view?: string | null;
}

export type AimeeLayer = "page" | "email" | "dialog";
const ORDER: AimeeLayer[] = ["dialog", "email", "page"];

let layers: Partial<Record<AimeeLayer, AimeePageCtx | null>> = {};
let snapshot: AimeePageCtx | null = null;
const subs = new Set<() => void>();

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Publish (or clear with null) one layer of the page context. */
export function setAimeeContext(layer: AimeeLayer, ctx: AimeePageCtx | null) {
  if (same(layers[layer] ?? null, ctx)) return;
  layers = { ...layers, [layer]: ctx };
  snapshot = ORDER.map((l) => layers[l]).find(Boolean) ?? null;
  subs.forEach((f) => f());
}

export function readAimeeContext(): AimeePageCtx | null {
  return snapshot;
}

const subscribe = (f: () => void) => {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
};

export function useAimeeContext(): AimeePageCtx | null {
  return useSyncExternalStore(subscribe, readAimeeContext, () => null);
}

/** One conversation per order, per email, else the general one. */
export function scopeOf(ctx: AimeePageCtx | null): string {
  if (ctx?.email?.id) return `email:${ctx.email.id}`;
  if (ctx?.orderId) return `order:${ctx.orderId}`;
  return "general";
}

// ── the aimee payload (only registered on a SHIPMENTS org with AIMEE on) ──────

export type AimeePayload = { page: AimeePageCtx | null; guides: Array<{ id: string; title: string }>; scope?: string };
let builder: (() => AimeePayload) | null = null;

export function registerAimeePayload(fn: (() => AimeePayload) | null) {
  builder = fn;
}

/** The payload for the next message, or undefined on every org that did not register one. */
export function aimeePayload(): AimeePayload | undefined {
  return builder ? builder() : undefined;
}

// ── the side panel ────────────────────────────────────────────────────────────

export const DOCK_EVENT = "aims:aimee-dock";
export type DockCommand = { action: "open" | "close" | "toggle"; prompt?: string; aboveModal?: boolean };

let dockMounted = false;
/** /preview only: show the AIMEE buttons without the org flags (nothing is fetched there). */
let forced = false;
export function setAimeePreviewOn(on: boolean) {
  forced = on;
}
export const aimeePreviewOn = () => forced;
export function setDockMounted(on: boolean) {
  dockMounted = on;
}
/** True when the AIMEE side panel exists on this org (the top-bar face then toggles it). */
export function dockAvailable(): boolean {
  return dockMounted;
}

export function commandDock(cmd: DockCommand) {
  window.dispatchEvent(new CustomEvent<DockCommand>(DOCK_EVENT, { detail: cmd }));
}
export const openDock = (opts: { prompt?: string; aboveModal?: boolean } = {}) => commandDock({ action: "open", ...opts });
export const toggleDock = () => commandDock({ action: "toggle" });

// ── walkthroughs ──────────────────────────────────────────────────────────────

export const GUIDE_EVENT = "aims:start-guide";
export function startGuide(guideId: string) {
  window.dispatchEvent(new CustomEvent<{ guideId: string }>(GUIDE_EVENT, { detail: { guideId } }));
}
