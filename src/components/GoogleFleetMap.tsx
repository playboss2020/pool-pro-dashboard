import { useEffect, useRef, useState } from "react";
import type { PoolDevice } from "../lib/deviceApi";

type FleetMapStatus = "online" | "warning" | "offline";

type FleetMapPoint = {
  device: PoolDevice;
  status: {
    kind: FleetMapStatus;
    label: string;
  };
};

type GoogleFleetMapProps = {
  points: FleetMapPoint[];
  onOpenDevice: (deviceId: string) => void;
};

declare global {
  interface Window {
    google?: any;
    __workflowGoogleMapsPromise?: Promise<void>;
  }
}

const googleMapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? "";

function propertyTitle(device: PoolDevice) {
  return device.property_name?.trim() || device.name || device.device_id;
}

function propertyAddress(device: PoolDevice) {
  return [device.address, device.city, device.state, device.zip].filter(Boolean).join(", ");
}

function markerColor(status: FleetMapStatus) {
  if (status === "online") return "#18a969";
  if (status === "warning") return "#e8842d";
  return "#d94b2f";
}

function initials(device: PoolDevice) {
  return propertyTitle(device).slice(0, 2).toUpperCase();
}

function loadGoogleMaps() {
  if (window.google?.maps) return Promise.resolve();
  if (window.__workflowGoogleMapsPromise) return window.__workflowGoogleMapsPromise;

  window.__workflowGoogleMapsPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(googleMapsApiKey)}&v=weekly`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Unable to load Google Maps"));
    document.head.appendChild(script);
  });

  return window.__workflowGoogleMapsPromise;
}

async function geocodeAddress(geocoder: any, address: string) {
  const cacheKey = `workflow-map-geocode:${address.toLowerCase()}`;
  const cached = window.sessionStorage.getItem(cacheKey);

  if (cached) {
    try {
      const parsed = JSON.parse(cached) as { lat: number; lng: number };
      if (Number.isFinite(parsed.lat) && Number.isFinite(parsed.lng)) return parsed;
    } catch {
      // Ignore a stale cache entry.
    }
  }

  return new Promise<{ lat: number; lng: number } | null>((resolve) => {
    geocoder.geocode({ address }, (results: any[], status: string) => {
      if (status !== "OK" || !results?.[0]?.geometry?.location) {
        resolve(null);
        return;
      }

      const location = results[0].geometry.location;
      const point = { lat: location.lat(), lng: location.lng() };
      window.sessionStorage.setItem(cacheKey, JSON.stringify(point));
      resolve(point);
    });
  });
}

export function GoogleFleetMap({ points, onOpenDevice }: GoogleFleetMapProps) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const markersRef = useRef<any[]>([]);
  const [mapError, setMapError] = useState("");

  useEffect(() => {
    if (!googleMapsApiKey || !mapRef.current) return undefined;

    let cancelled = false;

    async function renderMap() {
      try {
        setMapError("");
        await loadGoogleMaps();
        if (cancelled || !mapRef.current) return;

        markersRef.current.forEach((marker) => marker.setMap(null));
        markersRef.current = [];

        const google = window.google;
        const map = new google.maps.Map(mapRef.current, {
          center: { lat: 28.291956, lng: -81.40757 },
          zoom: 11,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
        });

        const geocoder = new google.maps.Geocoder();
        const bounds = new google.maps.LatLngBounds();
        let markerCount = 0;

        for (const point of points) {
          const address = propertyAddress(point.device);
          if (!address) continue;

          const coordinates = await geocodeAddress(geocoder, address);
          if (cancelled || !coordinates) continue;

          const marker = new google.maps.Marker({
            map,
            position: coordinates,
            title: `${propertyTitle(point.device)} - ${point.status.label}`,
            label: {
              text: initials(point.device),
              color: "#ffffff",
              fontSize: "11px",
              fontWeight: "900",
            },
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 18,
              fillColor: markerColor(point.status.kind),
              fillOpacity: 1,
              strokeColor: "#ffffff",
              strokeWeight: 3,
            },
          });

          marker.addListener("click", () => onOpenDevice(point.device.device_id));
          markersRef.current.push(marker);
          bounds.extend(coordinates);
          markerCount += 1;
        }

        if (markerCount === 1) {
          map.setCenter(bounds.getCenter());
          map.setZoom(14);
        } else if (markerCount > 1) {
          map.fitBounds(bounds, 80);
        } else {
          setMapError("No property addresses could be mapped yet.");
        }
      } catch (error) {
        setMapError(error instanceof Error ? error.message : "Google Maps failed to load");
      }
    }

    void renderMap();

    return () => {
      cancelled = true;
      markersRef.current.forEach((marker) => marker.setMap(null));
      markersRef.current = [];
    };
  }, [onOpenDevice, points]);

  if (!googleMapsApiKey) {
    return (
      <div className="pro-map-api-note">
        Add <strong>VITE_GOOGLE_MAPS_API_KEY</strong> to show real Google Maps streets and address pins.
      </div>
    );
  }

  return (
    <>
      <div className="pro-google-map" ref={mapRef} />
      {mapError ? <div className="pro-map-api-note">{mapError}</div> : null}
    </>
  );
}
