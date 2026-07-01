// Best-effort one-shot GPS fix. Web-standard navigator.geolocation (works in the
// Capacitor Android WebView AND plain browsers, no native plugin). Resolves to
// null on ANY failure — permission denied, no signal, timeout, or the API being
// unavailable — so a caller is NEVER blocked by GPS; latitude/longitude simply
// persist blank. Extracted verbatim from the field ack/install pages (previously
// duplicated inline in do/[doId] and install/[doId]) so the guest delivery flow
// captures the same one-shot coordinate.
export const capturePosition = (): Promise<{
  latitude: number;
  longitude: number;
} | null> =>
  new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  });
