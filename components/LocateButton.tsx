"use client";

import { useEffect, useRef, useState } from "react";
import L from "leaflet";

// El radar solo llega a zoom 7, pero el mapa en sí soporta mucho más detalle;
// al centrar en la ubicación del usuario (o en una población buscada a mano)
// conviene un zoom de calle/barrio.
export const LOCATE_ZOOM = 13;

type LocateButtonProps = {
  // El mapa se recibe por prop (en vez de useMap) para poder renderizar este
  // botón FUERA del contenedor de Leaflet, como un control flotante propio, y
  // colocarlo donde convenga sin depender de las esquinas de Leaflet.
  map: L.Map | null;
  onLocationFound?: (location: { lat: number; lon: number }) => void;
};

// Opciones de geolocalización pensadas sobre todo para el móvil:
// - timeout generoso: en un iPhone, con alta precisión y bajo techo, fijar el
//   GPS tarda bastante más que los 10 s que Leaflet da por defecto.
// - maximumAge: acepta una posición de hasta 1 minuto ya conocida por el
//   sistema, que es lo que hace que responda al instante en vez de encender el
//   GPS cada vez.
const LOCATE_OPTIONS = {
  setView: true,
  maxZoom: LOCATE_ZOOM,
  enableHighAccuracy: true,
  timeout: 20000,
  maximumAge: 60000,
} as const;

// Mensajes según el motivo real del fallo (antes se decía "Sin permiso" para
// todo, aunque el problema fuera otro y el usuario no supiera qué arreglar).
// Códigos del estándar: 1 = permiso denegado, 2 = posición no disponible,
// 3 = se agotó el tiempo.
function describeLocationError(code: number | undefined): { label: string; hint: string } {
  if (code === 1) {
    return {
      label: "Sin permiso",
      hint: "Has denegado el acceso a la ubicación. Actívalo en los ajustes del navegador para este sitio y vuelve a pulsar.",
    };
  }
  if (code === 3) {
    return {
      label: "Sin señal",
      hint: "Se agotó el tiempo buscando el GPS. Prueba al aire libre o vuelve a pulsar.",
    };
  }
  if (code === 2) {
    return {
      label: "No disponible",
      hint: "El dispositivo no ha podido determinar la ubicación. Comprueba que la localización del sistema está activada.",
    };
  }
  return {
    label: "Sin ubicación",
    hint: "No se ha podido obtener la ubicación. La geolocalización necesita una conexión segura (https). Vuelve a pulsar para reintentar.",
  };
}

export default function LocateButton({ map, onLocationFound }: LocateButtonProps) {
  const [status, setStatus] = useState<"idle" | "locating" | "error">("idle");
  const [errorInfo, setErrorInfo] = useState<{ label: string; hint: string } | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const circleRef = useRef<L.Circle | null>(null);
  // Evita tener que re-suscribir los eventos del mapa cada vez que el padre
  // pasa una nueva referencia de función (p. ej. un arrow function inline).
  const onLocationFoundRef = useRef(onLocationFound);
  onLocationFoundRef.current = onLocationFound;

  useEffect(() => {
    if (!map) return;

    const onFound = (e: L.LocationEvent) => {
      setStatus("idle");
      setErrorInfo(null);

      if (markerRef.current) map.removeLayer(markerRef.current);
      if (circleRef.current) map.removeLayer(circleRef.current);

      markerRef.current = L.marker(e.latlng).addTo(map).bindPopup("Estás aquí");
      circleRef.current = L.circle(e.latlng, { radius: e.accuracy, weight: 1 }).addTo(map);
      onLocationFoundRef.current?.({ lat: e.latlng.lat, lon: e.latlng.lng });
    };

    const onError = (e: L.ErrorEvent) => {
      setStatus("error");
      setErrorInfo(describeLocationError(e.code));
    };

    map.on("locationfound", onFound);
    map.on("locationerror", onError);

    return () => {
      map.off("locationfound", onFound);
      map.off("locationerror", onError);
    };
  }, [map]);

  const handleClick = () => {
    if (!map) return;
    setStatus("locating");
    setErrorInfo(null);
    map.locate(LOCATE_OPTIONS);
  };

  // Centrar automáticamente en la ubicación del dispositivo al cargar el mapa,
  // PERO solo si el permiso ya está concedido. Safari en iOS deniega de plano
  // (y recuerda la negativa) las peticiones de ubicación que no nacen de un
  // gesto del usuario: al pedirla sola nada más cargar, el iPhone la rechazaba
  // sin llegar a mostrar el diálogo, y el botón acababa diciendo "Sin permiso"
  // para siempre. Si el permiso está en "preguntar" o denegado, se espera a que
  // el usuario pulse el botón, que sí abre el diálogo del sistema.
  useEffect(() => {
    if (!map) return;
    let cancelled = false;

    async function autoLocateIfAlreadyAllowed() {
      try {
        const permission = await navigator.permissions?.query({
          name: "geolocation" as PermissionName,
        });
        if (!cancelled && permission?.state === "granted") handleClick();
      } catch {
        // Navegador sin Permissions API: no se fuerza nada; el usuario pulsa.
      }
    }

    autoLocateIfAlreadyAllowed();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  // Texto solo en pantallas anchas; en móvil el botón es compacto (icono) para
  // que quepa junto al buscador sin robar sitio. El estado (buscando / error)
  // sí se muestra siempre, porque es información que el usuario necesita.
  const label =
    status === "locating"
      ? "Buscando…"
      : status === "error" && errorInfo
        ? errorInfo.label
        : "Mi ubicación";

  return (
    <button
      onClick={handleClick}
      className={`flex shrink-0 items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium shadow-md disabled:opacity-60 ${
        status === "error"
          ? "bg-red-50 text-red-700 hover:bg-red-100"
          : "bg-white text-gray-800 hover:bg-gray-100"
      }`}
      disabled={status === "locating" || !map}
      title={errorInfo ? errorInfo.hint : "Ir a mi ubicación"}
      aria-label="Ir a mi ubicación"
    >
      <span className="text-base leading-none">📍</span>
      {/* En móvil solo se ve el icono salvo que haya algo que contar
          (buscando / error); en pantallas grandes se ve siempre el texto. */}
      <span className={status === "idle" ? "hidden sm:inline" : "inline"}>{label}</span>
    </button>
  );
}
