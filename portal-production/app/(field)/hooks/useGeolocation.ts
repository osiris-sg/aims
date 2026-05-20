"use client";

import { useCallback, useEffect, useState } from "react";

export type GeoState = "capturing" | "captured" | "failed" | "unavailable";

export interface GeoCoords {
  latitude: number;
  longitude: number;
  accuracyM?: number;
}

export interface UseGeolocationResult {
  state: GeoState;
  coords: GeoCoords | null;
  errorMessage: string | null;
  retry: () => void;
}

/**
 * Auto-captures GPS on mount. Designed for the delivery start / ack pages —
 * the technician sees a visible status indicator and can retry on failure,
 * but submission is never blocked by geolocation outcome.
 */
export function useGeolocation(): UseGeolocationResult {
  const [state, setState] = useState<GeoState>("capturing");
  const [coords, setCoords] = useState<GeoCoords | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const capture = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setState("unavailable");
      setErrorMessage("Browser does not support geolocation.");
      return;
    }
    setState("capturing");
    setErrorMessage(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracyM: pos.coords.accuracy,
        });
        setState("captured");
      },
      (err) => {
        setCoords(null);
        setState("failed");
        const msg =
          err.code === err.PERMISSION_DENIED
            ? "Location permission denied."
            : err.code === err.POSITION_UNAVAILABLE
              ? "Location is currently unavailable."
              : err.code === err.TIMEOUT
                ? "Location request timed out."
                : err.message || "Could not get location.";
        setErrorMessage(msg);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }, []);

  useEffect(() => {
    capture();
  }, [capture]);

  return { state, coords, errorMessage, retry: capture };
}

/**
 * Format coordinates Singapore-style: "1.3521° N, 103.8198° E".
 */
export function formatCoords(c: GeoCoords | null): string {
  if (!c) return "";
  const lat = `${Math.abs(c.latitude).toFixed(4)}° ${c.latitude >= 0 ? "N" : "S"}`;
  const lng = `${Math.abs(c.longitude).toFixed(4)}° ${c.longitude >= 0 ? "E" : "W"}`;
  return `${lat}, ${lng}`;
}
