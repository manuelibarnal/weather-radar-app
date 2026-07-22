// Detección de lluvia en Node: misma lógica que la app (analyzeMosaicPixels +
// evaluateRainApproach de lib/rainDetection), solo cambia de dónde salen los
// píxeles (PNG decodificado en vez de canvas del navegador).
import type { RadarFrame } from "../lib/rainviewer";
import {
  ANALYSIS_ZOOM,
  FORECAST_FRAMES_TO_ANALYZE,
  PAST_FRAMES_TO_ANALYZE,
  TILE_RADIUS,
  TILE_SIZE,
  analyzeMosaicPixels,
  evaluateRainApproach,
  latLonToGlobalPixel,
  type FrameRainAnalysis,
  type RainApproachResult,
} from "../lib/rainDetection";
import { loadMosaicPixelsNode } from "./tiles";

// Pausa entre frames para no disparar el límite de ráfaga de RainViewer (mismo
// motivo que en la app; aquí también descargamos ~9 teselas por frame).
const FRAME_DELAY_MS = 400;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function detectRainApproachNode(
  host: string,
  pastFrames: RadarFrame[],
  nowcastFrames: RadarFrame[],
  location: { lat: number; lon: number }
): Promise<RainApproachResult> {
  if (pastFrames.length === 0) return { status: "unknown" };

  const point = latLonToGlobalPixel(location.lat, location.lon, ANALYSIS_ZOOM);
  const centerTile = {
    x: Math.floor(point.x / TILE_SIZE),
    y: Math.floor(point.y / TILE_SIZE),
  };
  const originPx = {
    x: (centerTile.x - TILE_RADIUS) * TILE_SIZE,
    y: (centerTile.y - TILE_RADIUS) * TILE_SIZE,
  };
  const userPxInMosaic = { x: point.x - originPx.x, y: point.y - originPx.y };

  const metersPerPixel =
    (156543.03392 * Math.cos((location.lat * Math.PI) / 180)) / Math.pow(2, ANALYSIS_ZOOM);
  const kmPerPixel = metersPerPixel / 1000;

  const analyze = async (frame: RadarFrame, isForecast: boolean): Promise<FrameRainAnalysis> => {
    const { data, mosaicSize } = await loadMosaicPixelsNode(host, frame, centerTile);
    return analyzeMosaicPixels(data, mosaicSize, userPxInMosaic, kmPerPixel, isForecast, frame.time);
  };

  const results: FrameRainAnalysis[] = [];
  for (const frame of pastFrames.slice(-PAST_FRAMES_TO_ANALYZE)) {
    results.push(await analyze(frame, false));
    await sleep(FRAME_DELAY_MS);
  }

  const forecastResults: FrameRainAnalysis[] = [];
  for (const frame of nowcastFrames.slice(0, FORECAST_FRAMES_TO_ANALYZE)) {
    forecastResults.push(await analyze(frame, true));
    await sleep(FRAME_DELAY_MS);
  }

  return evaluateRainApproach(results, forecastResults, kmPerPixel);
}
