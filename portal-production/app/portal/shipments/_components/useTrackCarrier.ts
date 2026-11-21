"use client";

// "Track (carrier)": opens the carrier's own tracking page — link only, no scraping. Where the page can't take the B/L
// in its URL (Wan Hai, SITC, MSC …) the B/L is copied first, to paste into the carrier's search box.
// Shared by the tracking card and the Tracking list (round BX).

import { useTranslations } from "next-intl";
import { toast } from "../_lib/toast";

export type TrackCarrier = { code: string; name: string; url: string; prefilled: boolean };

export function useTrackCarrier() {
  const t = useTranslations("shipments.portStoragePanel");
  return async (carrier: TrackCarrier | null | undefined, blNumber: string | null | undefined) => {
    if (!carrier) return;
    // Start the copy while this page still has focus, then open the carrier's page straight from the click.
    const copy = !carrier.prefilled && blNumber ? navigator.clipboard?.writeText(blNumber) : null;
    window.open(carrier.url, "_blank", "noopener");
    if (!copy || !blNumber) return;
    try {
      await copy;
      toast.info(t("copied", { bl: blNumber, carrier: carrier.name }));
    } catch {
      toast.info(t("search", { carrier: carrier.name, bl: blNumber }));
    }
  };
}
