"use client";

// Where the fleet physically sits. Unit pins come from the GPS fix captured
// when a technician tags a unit in the field; visit pins come from the
// coordinates stamped on a service report or delivery event.
//
// Must be imported with `ssr: false` — Leaflet touches `window` at import time
// and crashes Next's server render (same constraint as DeliveryRouteMap).

import React, { useMemo } from "react";
import { Box, Typography } from "@mui/material";
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";

export interface UnitPoint {
  sku: string;
  asset: string;
  status: string;
  lat: number;
  lng: number;
}
export interface VisitPoint {
  ref: string;
  kind: string;
  at: string;
  lat: number;
  lng: number;
}

// Status drives the pin colour, matching the stock chart's slots so the two
// read as one system.
const STATUS_FILL: Record<string, string> = {
  instock: "#1baf7a",
  rental: "#2a78d6",
  reserved: "#eda100",
  maintenance: "#eb6834",
  sold: "#e87ba4",
  pending: "#9aa0a6",
};

function FitToPoints({ points }: { points: Array<[number, number]> }) {
  const map = useMap();
  useMemo(() => {
    if (!points.length) return;
    if (points.length === 1) {
      map.setView(points[0], 14);
      return;
    }
    const lats = points.map((p) => p[0]);
    const lngs = points.map((p) => p[1]);
    map.fitBounds(
      [
        [Math.min(...lats), Math.min(...lngs)],
        [Math.max(...lats), Math.max(...lngs)],
      ],
      { padding: [28, 28] },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points.length]);
  return null;
}

export default function FleetMap({
  units,
  visits,
  height = 380,
}: {
  units: UnitPoint[];
  visits: VisitPoint[];
  height?: number;
}) {
  const all = useMemo(
    () => [...units, ...visits].map((p) => [p.lat, p.lng] as [number, number]).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])),
    [units, visits],
  );

  if (!all.length) {
    return (
      <Box sx={{ height, display: "flex", alignItems: "center", justifyContent: "center", bgcolor: "action.hover", borderRadius: 1 }}>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          No GPS positions recorded yet. Units get a position when a technician tags them in the field.
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ height, borderRadius: 1, overflow: "hidden", "& .leaflet-container": { height: "100%", width: "100%" } }}>
      <MapContainer center={all[0]} zoom={12} scrollWheelZoom={false} style={{ height: "100%", width: "100%" }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitToPoints points={all} />

        {/* Service / delivery visits sit underneath as soft markers. */}
        {visits.map((v) => (
          <CircleMarker
            key={`v-${v.ref}`}
            center={[v.lat, v.lng]}
            radius={5}
            pathOptions={{ color: "#7a7a7a", weight: 2, fillColor: "#7a7a7a", fillOpacity: 0.25 }}
          >
            <Popup>
              <strong>{v.ref}</strong>
              <br />
              {v.kind.replace(/_/g, " ").toLowerCase()}
              <br />
              {new Date(v.at).toLocaleDateString("en-SG")}
            </Popup>
          </CircleMarker>
        ))}

        {/* Units on top — 8px markers with a 2px surface ring. */}
        {units.map((u) => (
          <CircleMarker
            key={`u-${u.sku}`}
            center={[u.lat, u.lng]}
            radius={6}
            pathOptions={{
              color: "#ffffff",
              weight: 2,
              fillColor: STATUS_FILL[u.status] || "#9aa0a6",
              fillOpacity: 1,
            }}
          >
            <Popup>
              <strong>{u.asset}</strong>
              <br />
              {u.sku}
              <br />
              {u.status}
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </Box>
  );
}
