"use client";

import React, { useEffect, useMemo } from "react";
import { Box, Typography } from "@mui/material";
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/**
 * Live delivery route map. Renders a Leaflet polyline through all GPS pings
 * recorded by the field-tech app between Start Delivery and Acknowledge
 * Delivery, plus distinctive start/end markers and a pulsing live marker
 * when the delivery is still in progress.
 *
 * Must be loaded with `ssr: false` — Leaflet hits `window` at import time
 * and crashes Next.js's server-render step.
 */

export interface DeliveryPing {
  id?: string;
  latitude: number;
  longitude: number;
  timestamp: string;
}

interface Props {
  pings: DeliveryPing[];
  isActive: boolean;
}

// Leaflet ships marker assets via relative paths that don't survive Next.js's
// bundling. Repoint them at the unpkg CDN copies once, at module-load time.
// (Safe to re-run; mergeOptions overwrites.)
const fixLeafletDefaultIcon = () => {
  delete (L.Icon.Default.prototype as any)._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
    iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
    shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  });
};
fixLeafletDefaultIcon();

// Coloured circle markers (start/end) — rendered as divIcons so we don't
// have to ship custom PNGs through the asset pipeline.
const startIcon = L.divIcon({
  className: "aims-marker-start",
  iconSize: [22, 22],
  iconAnchor: [11, 11],
  html: `<div style="
    width: 18px; height: 18px;
    background: #2e7d32; border: 3px solid white; border-radius: 50%;
    box-shadow: 0 0 0 1px #2e7d32, 0 2px 4px rgba(0,0,0,0.35);
  "></div>`,
});

const endIcon = L.divIcon({
  className: "aims-marker-end",
  iconSize: [22, 22],
  iconAnchor: [11, 11],
  html: `<div style="
    width: 18px; height: 18px;
    background: #c62828; border: 3px solid white; border-radius: 50%;
    box-shadow: 0 0 0 1px #c62828, 0 2px 4px rgba(0,0,0,0.35);
  "></div>`,
});

// Pulsing blue dot for the live "where the tech is right now" position.
// Keyframe registered once on first render; idempotent re-registration is fine.
const ensurePulseKeyframes = (() => {
  let injected = false;
  return () => {
    if (injected || typeof document === "undefined") return;
    const style = document.createElement("style");
    style.textContent = `
      @keyframes aims-pulse {
        0%   { transform: scale(0.8); opacity: 0.9; }
        70%  { transform: scale(2.2); opacity: 0;   }
        100% { transform: scale(2.2); opacity: 0;   }
      }
    `;
    document.head.appendChild(style);
    injected = true;
  };
})();

const livePulseIcon = L.divIcon({
  className: "aims-marker-live",
  iconSize: [22, 22],
  iconAnchor: [11, 11],
  html: `<div style="position: relative; width: 18px; height: 18px;">
    <div style="
      position: absolute; inset: 0;
      background: #1976d2; border-radius: 50%;
      animation: aims-pulse 1.6s ease-out infinite;
    "></div>
    <div style="
      position: absolute; inset: 3px;
      background: #1976d2; border: 2px solid white; border-radius: 50%;
      box-shadow: 0 2px 4px rgba(0,0,0,0.35);
    "></div>
  </div>`,
});

/**
 * Recenters / refits the map whenever the ping set changes. Lives inside
 * MapContainer's render tree so it can access the map instance via useMap.
 */
function FitToPings({ pings }: { pings: DeliveryPing[] }) {
  const map = useMap();
  useEffect(() => {
    if (pings.length === 0) return;
    if (pings.length === 1) {
      map.setView([pings[0].latitude, pings[0].longitude], 16);
      return;
    }
    const bounds = L.latLngBounds(
      pings.map((p) => [p.latitude, p.longitude] as [number, number]),
    );
    map.fitBounds(bounds, { padding: [40, 40] });
  }, [map, pings]);
  return null;
}

export default function DeliveryRouteMap({ pings, isActive }: Props) {
  useEffect(() => {
    ensurePulseKeyframes();
  }, []);

  const polyline = useMemo(
    () => pings.map((p) => [p.latitude, p.longitude] as [number, number]),
    [pings],
  );

  const startPing = pings[0];
  const lastPing = pings[pings.length - 1];

  if (pings.length === 0) {
    return (
      <Box sx={{ p: 6, textAlign: "center", color: "text.secondary" }}>
        <Typography variant="body2">No location data yet for this delivery.</Typography>
        <Typography variant="caption" color="text.secondary">
          {isActive
            ? "Pings will appear here once the tech's phone has reported a position."
            : "This delivery has no recorded GPS pings."}
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ width: "100%", height: { xs: "60vh", md: "70vh" }, position: "relative" }}>
      <MapContainer
        center={[startPing.latitude, startPing.longitude]}
        zoom={15}
        scrollWheelZoom
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitToPings pings={pings} />

        {polyline.length > 1 && (
          <Polyline positions={polyline} pathOptions={{ color: "#1976d2", weight: 4, opacity: 0.85 }} />
        )}

        <Marker position={[startPing.latitude, startPing.longitude]} icon={startIcon}>
          <Popup>
            <strong>Started</strong>
            <br />
            {new Date(startPing.timestamp).toLocaleString()}
          </Popup>
        </Marker>

        {lastPing && lastPing !== startPing && (
          <Marker
            position={[lastPing.latitude, lastPing.longitude]}
            icon={isActive ? livePulseIcon : endIcon}
          >
            <Popup>
              <strong>{isActive ? "Current position" : "Delivered"}</strong>
              <br />
              {new Date(lastPing.timestamp).toLocaleString()}
            </Popup>
          </Marker>
        )}
      </MapContainer>
    </Box>
  );
}
