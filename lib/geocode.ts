export type GeocodeResult = {
  lat: number;
  lon: number;
  displayName: string;
};

// Nominatim (buscador gratuito de OpenStreetMap, sin clave de API). Su
// política de uso pide un ritmo bajo de peticiones (esto solo se llama al
// enviar una búsqueda manual del usuario, nunca en bucle ni automáticamente).
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

export async function geocodeLocation(query: string): Promise<GeocodeResult | null> {
  const url = `${NOMINATIM_URL}?format=json&limit=1&accept-language=es&q=${encodeURIComponent(
    query
  )}`;
  const res = await fetch(url);
  if (!res.ok) return null;

  const data: Array<{ lat: string; lon: string; display_name: string }> = await res.json();
  if (!Array.isArray(data) || data.length === 0) return null;

  const first = data[0];
  return {
    lat: parseFloat(first.lat),
    lon: parseFloat(first.lon),
    displayName: first.display_name,
  };
}
