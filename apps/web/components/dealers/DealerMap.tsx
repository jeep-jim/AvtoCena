"use client";
import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import type { DealerOffice } from "@/lib/dealers/showcase-model";
export function DealerMap({
  offices,
  tiles = "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
}: {
  offices: DealerOffice[];
  tiles?: string;
}) {
  const ref = useRef<HTMLDivElement>(null),
    [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (!enabled || !ref.current) return;
    let disposed = false;
    let map: import("leaflet").Map | undefined;
    void import("leaflet").then((L) => {
      if (disposed || !ref.current) return;
      const points = offices.filter((o) => o.lat !== null && o.lon !== null);
      if (!points.length) return;
      map = L.map(ref.current, { scrollWheelZoom: false }).setView(
        [points[0].lat!, points[0].lon!],
        14,
      );
      L.tileLayer(tiles, {
        maxZoom: 19,
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);
      const icon = L.divIcon({
        className: "",
        html: '<svg width="30" height="40" viewBox="0 0 30 40"><path d="M15 1C-2 1-4 21 15 39C34 21 32 1 15 1" fill="#e33434" stroke="white" stroke-width="2"/><circle cx="15" cy="14" r="5" fill="white"/></svg>',
        iconSize: [30, 40],
        iconAnchor: [15, 40],
      });
      points.forEach((o) => {
        const content = document.createElement("div");
        content.textContent = `${o.city}, ${o.address}`;
        L.marker([o.lat!, o.lon!], { icon }).bindPopup(content).addTo(map!);
      });
      if (points.length > 1)
        map.fitBounds(
          L.latLngBounds(
            points.map((o) => [o.lat!, o.lon!] as [number, number]),
          ),
          { padding: [30, 30], maxZoom: 15 },
        );
    });
    return () => {
      disposed = true;
      map?.remove();
    };
  }, [enabled, offices, tiles]);
  if (!offices.some((o) => o.lat !== null && o.lon !== null)) return null;
  return (
    <section className="mt-6">
      <h2 className="mb-3 text-2xl font-black">Офисы на карте</h2>
      {enabled ? (
        <div
          ref={ref}
          className="relative z-0 h-80 w-full rounded-2xl"
          aria-label="Карта офисов дилера"
        />
      ) : (
        <button
          className="w-full rounded-2xl border border-[var(--ac-border)] bg-[var(--ac-surface)] p-10 font-bold"
          onClick={() => setEnabled(true)}
        >
          Показать карту офисов
        </button>
      )}
      <p className="mt-2 text-xs text-[var(--ac-muted)]">
        Карта OpenStreetMap ·{" "}
        <a
          href="https://www.openstreetmap.org/fixthemap"
          target="_blank"
          rel="noreferrer"
        >
          Сообщить об ошибке
        </a>
      </p>
    </section>
  );
}
