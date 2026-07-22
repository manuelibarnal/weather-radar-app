export type RadarFrame = {
  time: number;
  path: string;
};

export type RainviewerData = {
  host: string;
  past: RadarFrame[];
  nowcast: RadarFrame[];
};

type RainviewerApiResponse = {
  version: string;
  generated: number;
  host: string;
  radar: {
    past: RadarFrame[];
    nowcast: RadarFrame[];
  };
};

const API_URL = "https://api.rainviewer.com/public/weather-maps.json";

// La documentación oficial de RainViewer indica que el nivel máximo de zoom
// soportado por su servidor de teselas de radar es 7; por encima de eso las
// teselas responden "ZOOM NOT SUPPORTED" en vez de una imagen.
// https://www.rainviewer.com/api/weather-maps-api.html
export const RADAR_MIN_ZOOM = 3;
export const RADAR_MAX_ZOOM = 7;

export async function fetchRainviewerData(): Promise<RainviewerData> {
  const res = await fetch(API_URL);
  if (!res.ok) {
    throw new Error(`No se pudieron cargar los datos de radar (${res.status})`);
  }
  const data: RainviewerApiResponse = await res.json();
  return {
    host: data.host,
    past: data.radar.past ?? [],
    nowcast: data.radar.nowcast ?? [],
  };
}

// color: 2 = "Universal Blue", 4 = "Titan", 8 = "Meteored". options "1_1" = smooth + snow layer.
export function buildTileUrl(host: string, frame: RadarFrame, color = 4): string {
  return `${host}${frame.path}/256/{z}/{x}/{y}/${color}/1_1.png`;
}

export function buildTileUrlForCoord(
  host: string,
  frame: RadarFrame,
  z: number,
  x: number,
  y: number,
  color = 4
): string {
  return `${host}${frame.path}/256/${z}/${x}/${y}/${color}/1_1.png`;
}

export function formatFrameTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
