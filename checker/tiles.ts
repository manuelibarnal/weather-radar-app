// Carga de teselas de radar en Node (para el comprobador de la nube). Hace lo
// mismo que el canvas del navegador pero sin DOM: descarga las teselas del
// mosaico 3x3, las decodifica con pngjs y las compone en un único array RGBA
// continuo (mosaicSize x mosaicSize), que es justo lo que espera
// analyzeMosaicPixels de lib/rainDetection.
//
// RainViewer aplica un límite de ráfaga agresivo (responde 429 durante un rato
// si se piden demasiadas teselas de golpe). Por eso aquí: (1) se cachea cada
// tesela por URL dentro de la ejecución —ubicaciones cercanas comparten teselas
// del mismo frame—, (2) se reintenta con espera ante un 429, y (3) las teselas
// del mosaico se piden de una en una, no las 9 a la vez.
import { PNG } from "pngjs";
import { buildTileUrlForCoord, type RadarFrame } from "../lib/rainviewer";
import { ANALYSIS_ZOOM, TILE_RADIUS, TILE_SIZE } from "../lib/rainDetection";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MAX_429_RETRIES = 4;

const tileCache = new Map<string, Promise<Buffer | null>>();

async function fetchTilePixels(url: string, attempt = 0): Promise<Buffer | null> {
  try {
    const res = await fetch(url);
    if (res.status === 429 && attempt < MAX_429_RETRIES) {
      // Espera creciente con algo de azar (backoff) antes de reintentar.
      await sleep(1500 * (attempt + 1) + Math.random() * 1500);
      return fetchTilePixels(url, attempt + 1);
    }
    if (!res.ok) return null;
    const png = PNG.sync.read(Buffer.from(await res.arrayBuffer()));
    if (png.width !== TILE_SIZE || png.height !== TILE_SIZE) return null;
    return png.data; // RGBA continuo, TILE_SIZE x TILE_SIZE
  } catch {
    return null;
  }
}

// Descarga (o reutiliza de caché) una tesela por su URL.
export function getTilePixels(url: string): Promise<Buffer | null> {
  let p = tileCache.get(url);
  if (!p) {
    p = fetchTilePixels(url);
    tileCache.set(url, p);
  }
  return p;
}

export async function loadMosaicPixelsNode(
  host: string,
  frame: RadarFrame,
  centerTile: { x: number; y: number }
): Promise<{ data: Uint8Array; mosaicSize: number }> {
  const mosaicSize = (TILE_RADIUS * 2 + 1) * TILE_SIZE;
  // Todo a 0 = transparente; las teselas que falten se quedan sin lluvia, igual
  // que en el navegador cuando una tesela no carga.
  const data = new Uint8Array(mosaicSize * mosaicSize * 4);

  for (let dx = -TILE_RADIUS; dx <= TILE_RADIUS; dx++) {
    for (let dy = -TILE_RADIUS; dy <= TILE_RADIUS; dy++) {
      const url = buildTileUrlForCoord(host, frame, ANALYSIS_ZOOM, centerTile.x + dx, centerTile.y + dy);
      // De una en una (no las 9 a la vez) para no disparar el límite de ráfaga.
      const tile = await getTilePixels(url);
      if (!tile) continue;
      const offX = (dx + TILE_RADIUS) * TILE_SIZE;
      const offY = (dy + TILE_RADIUS) * TILE_SIZE;
      for (let y = 0; y < TILE_SIZE; y++) {
        const srcRow = y * TILE_SIZE * 4;
        const dstRow = ((offY + y) * mosaicSize + offX) * 4;
        data.set(tile.subarray(srcRow, srcRow + TILE_SIZE * 4), dstRow);
      }
    }
  }
  return { data, mosaicSize };
}
