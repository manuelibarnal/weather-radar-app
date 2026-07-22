// Diagnóstico: escanea el radar mundial (zoom bajo) en el frame más reciente y
// dice en qué teselas hay lluvia. Sirve para (a) confirmar que el decodificado
// PNG funciona en Node y (b) encontrar una zona con lluvia para probar el
// veredicto completo. No forma parte del comprobador; es solo una herramienta.
import { buildTileUrlForCoord, fetchRainviewerData } from "../lib/rainviewer";
import { getTilePixels } from "./tiles";

const Z = 3; // 2^3 = 8 -> 64 teselas para cubrir el mundo
const ALPHA = 20;
const TILE = 256;

// Convierte un píxel global (en el mundo de 256*2^z px) a lat/lon. Sirve para
// dar la coordenada EXACTA de la lluvia dentro de una tesela, no solo su centro.
function globalPixelLatLon(gx: number, gy: number, z: number) {
  const scale = TILE * 2 ** z;
  const lon = (gx / scale) * 360 - 180;
  const m = Math.PI - (2 * Math.PI * gy) / scale;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(m) - Math.exp(-m)));
  return { lat, lon };
}

async function main() {
  const data = await fetchRainviewerData();
  const frame = data.past.at(-1)!;
  console.log(`Frame más reciente: ${new Date(frame.time * 1000).toISOString()}`);

  const found: { x: number; y: number; rainy: number; lat: number; lon: number }[] = [];
  let okTiles = 0;

  for (let x = 0; x < 2 ** Z; x++) {
    for (let y = 0; y < 2 ** Z; y++) {
      const url = buildTileUrlForCoord(data.host, frame, Z, x, y);
      const tile = await getTilePixels(url); // secuencial, con reintento ante 429
      if (!tile) continue;
      okTiles++;
      // Centroide de los píxeles con lluvia dentro de la tesela, para dar una
      // coordenada donde realmente hay lluvia (no el centro geométrico).
      let rainy = 0;
      let sumPx = 0;
      let sumPy = 0;
      for (let py = 0; py < TILE; py++) {
        for (let px = 0; px < TILE; px++) {
          if (tile[(py * TILE + px) * 4 + 3] > ALPHA) {
            rainy++;
            sumPx += px;
            sumPy += py;
          }
        }
      }
      if (rainy > 0) {
        const gx = x * TILE + sumPx / rainy;
        const gy = y * TILE + sumPy / rainy;
        const { lat, lon } = globalPixelLatLon(gx, gy, Z);
        found.push({ x, y, rainy, lat, lon });
      }
    }
  }

  console.log(`Teselas decodificadas OK: ${okTiles}/64`);
  found.sort((a, b) => b.rainy - a.rainy);
  console.log(`Teselas con lluvia: ${found.length}. Top 6:`);
  for (const f of found.slice(0, 6)) {
    console.log(
      `  (${f.x},${f.y}) píxeles=${f.rainy}  ~centro lat=${f.lat.toFixed(2)} lon=${f.lon.toFixed(2)}`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
