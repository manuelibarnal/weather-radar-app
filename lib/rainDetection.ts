import { buildTileUrlForCoord, type RadarFrame } from "./rainviewer";
import { dbzToMmPerHour, intensityRank, rgbToDbz } from "./rainColorScale";

// Se analiza siempre al mismo zoom que usa el radar como máximo (7): da una
// resolución de menos de 1 km/píxel, de sobra para este propósito, y permite
// reaprovechar teselas que ya estén en caché del navegador por el mapa.
export const ANALYSIS_ZOOM = 7;
export const TILE_SIZE = 256;
// Radio de teselas alrededor del punto: 1 = mosaico de 3x3 (~700x700 km),
// suficiente margen para detectar tormentas con antelación razonable.
export const TILE_RADIUS = 1;
// Alpha mínimo (0-255) para considerar que un píxel tiene algún color de
// radar (frente a totalmente transparente). Por debajo de esto no hay nada
// que analizar.
const RAIN_ALPHA_THRESHOLD = 20;
// Intensidad mínima (l/m²/h) para que un píxel cuente como "lluvia" a
// efectos de avisos. RainViewer colorea hasta trazas casi imperceptibles
// (menos de 0.1 l/m²/h); este suelo las descarta. Se avisa a partir de
// 0.5 l/m²/h, que ya es una llovizna ligera perceptible.
const MEANINGFUL_RAIN_MM_PER_HOUR = 0.5;
// Intensidad (l/m²/h) a partir de la cual un píxel cuenta como "núcleo
// intenso" (coincide con el límite de la categoría "Alta"), para poder
// avisar de un núcleo fuerte cercano solo cuando ese núcleo en concreto se
// esté acercando de verdad, no solo porque haya alguno en la zona analizada.
const INTENSE_RAIN_MM_PER_HOUR = 10;
// Paso de muestreo al buscar el píxel de lluvia más cercano: analizar cada
// píxel de un mosaico de 768x768 es innecesario: con cada 2 px de por medio
// ya hay resolución de sobra y es ~4 veces más rápido.
const SAMPLE_STEP = 2;
// Área mínima (en celdas de la rejilla) que debe tener un núcleo para que su
// intensidad cuente como "lo que va a caer". Sin esto, un solo píxel amarillo
// suelto —de área insignificante y probabilidad muy baja— disparaba avisos de
// intensificación. Cada celda son ~1.8x1.8 km (~3 km²), así que 12 celdas son
// ~40 km²: un núcleo pequeño pero real, no un punto aislado.
const MIN_CORE_CELLS = 12;
// Minutos consecutivos que la lluvia debe mantenerse por encima del umbral de
// aumento para considerar que "va a intensificarse" mientras ya llueve. Una
// celda diminuta cruzando por encima da uno o dos minutos; una intensificación
// real se sostiene. Filtra el mismo problema del punto aislado en el tiempo.
const MIN_SUSTAINED_INCREASE_MIN = 5;
// Espera entre el análisis de un frame y el siguiente, para no lanzar de
// golpe todas las teselas de los ~7 frames analizados (mismo motivo que el
// resto de la app: evitar el límite de ráfaga de RainViewer).
const FRAME_ANALYSIS_DELAY_MS = 400;
// Cuántos frames pasados (más recientes) y de previsión se analizan.
export const PAST_FRAMES_TO_ANALYZE = 4;
export const FORECAST_FRAMES_TO_ANALYZE = 3;
// Por debajo de este acercamiento acumulado (km) entre el primer y el último
// frame analizado, se considera ruido y no una tormenta acercándose de
// verdad.
const MIN_APPROACH_KM = 5;
// Límite superior de velocidad SOLO para acotar la búsqueda de correlación del
// vector de movimiento (cuántas celdas como máximo puede haberse desplazado el
// campo entre dos frames). No se rechaza un frente por ser rápido —si va
// rápido, mejor avisar—; es un margen generoso, muy por encima de cualquier
// frente real, para no dejar fuera ninguno y a la vez acotar el cómputo.
const MOTION_SEARCH_MAX_KMH = 200;
// Horizonte máximo de aviso: más allá de esto no se contempla nada (ni
// acercamiento, ni tendencia de la lluvia ya presente). Se exporta porque es
// también el horizonte real que cubre un resultado "clear", usado para el
// mensaje por defecto.
export const MAX_ETA_MINUTES = 60;
// Umbrales para decidir si, entre el frame actual y el último de previsión
// analizado, la intensidad en el punto se considera que sube, baja o se
// mantiene (proporción futura/actual).
const INTENSITY_INCREASE_RATIO = 1.4;
const INTENSITY_DECREASE_RATIO = 0.6;
// Diferencia de dBZ para considerar un píxel cercano notablemente "más
// intenso" o "más flojo" que el de la ubicación (mientras llueve), al buscar
// si un núcleo más fuerte o el borde de la lluvia se están acercando.
const HEAVIER_DBZ_MARGIN = 5;
const LIGHTER_DBZ_MARGIN = 5;
// Detección de acercamiento por vector de movimiento del campo de lluvia:
// celdas de lluvia solapadas mínimas entre dos frames para fiarnos del
// desplazamiento estimado (por debajo, es ruido y no se estima movimiento).
const MIN_MOTION_OVERLAP_CELLS = 30;
// Ancho medio (km) del corredor de aproximación: una celda de lluvia se
// considera "de camino hacia el punto" si su trayectoria (según el vector de
// movimiento) pasa a menos de esto del punto. Da margen para el error de
// dirección y para frentes anchos, sin contar lluvia que pasa de largo lejos.
const APPROACH_CORRIDOR_HALF_KM = 10;
// Velocidad mínima (km/h) para considerar que el campo se mueve de verdad;
// por debajo se trata como estacionario (no hay acercamiento que proyectar).
const MIN_MOTION_SPEED_KMH = 4;

export type FrameRainAnalysis = {
  time: number;
  isForecast: boolean;
  rainingAtLocation: boolean;
  // Intensidad (l/m²/h) en el punto exacto de la ubicación, solo si llueve ahí.
  intensityAtLocationMmPerHour: number | null;
  nearestRainKm: number | null;
  // Intensidad (l/m²/h) en el punto de lluvia más cercano encontrado. El
  // punto más cercano suele ser el borde de entrada del frente, casi siempre
  // mucho más flojo que su núcleo — no representa la gravedad de un núcleo
  // más fuerte que pueda haber más lejos (ver nearestIntenseKm).
  nearestRainIntensityMmPerHour: number | null;
  // Distancia e intensidad del núcleo intenso (≥ INTENSE_RAIN_MM_PER_HOUR)
  // más cercano, si lo hay. A diferencia de tomar sin más la intensidad
  // máxima de todo el mosaico analizado, esto permite comprobar (viendo su
  // propia distancia a lo largo de varios frames) si ESE núcleo en concreto
  // se está acercando de verdad, y no avisar de un frente grande que esté
  // simplemente ahí al lado sin dirigirse hacia la ubicación.
  nearestIntenseKm: number | null;
  nearestIntenseIntensityMmPerHour: number | null;
  // Solo se calculan si ya llueve en la ubicación: distancia al punto más
  // cercano notablemente más intenso (núcleo acercándose) o más flojo/sin
  // lluvia (borde de la tormenta acercándose).
  nearestHeavierKm: number | null;
  nearestLighterKm: number | null;
  // Rejilla de intensidad (l/m²/h; 0 = sin lluvia significativa) del mosaico,
  // submuestreada a paso SAMPLE_STEP. Se usa para estimar el vector de
  // movimiento del campo de lluvia entre frames consecutivos y proyectar si
  // ese movimiento traerá lluvia sobre el punto (detección de acercamiento
  // por dirección real, no por "punto más cercano"). gridW = ancho en celdas.
  grid: Float32Array;
  gridW: number;
  // Posición del usuario dentro de la rejilla (en celdas, con decimales).
  userGridX: number;
  userGridY: number;
};

// Cómo se espera que evolucione la lluvia que ya está cayendo en el punto:
// a partir de los frames de previsión de RainViewer si los hay, o si no, a
// partir de la propia tendencia en los frames pasados (ver
// estimatePastTrend). "source" distingue de cuál de los dos viene el dato,
// porque la previsión real de RainViewer es más fiable que nuestra propia
// extrapolación por movimiento.
export type RainTrend =
  // mmPerHour: a qué intensidad se espera que suba (si se sabe), para poder
  // decir "aumentará a lluvia moderada (6 l/m²/h)" en vez de solo "aumentará".
  | {
      kind: "increasing";
      etaMinutes: number | null;
      mmPerHour?: number | null;
      source: "forecast" | "trend";
    }
  | { kind: "decreasing"; etaMinutes: number | null; source: "forecast" | "trend" }
  | { kind: "ending"; etaMinutes: number; source: "forecast" | "trend" }
  | { kind: "steady"; forMinutes: number; source: "forecast" | "trend" };

export type RainApproachResult =
  | { status: "raining"; time: number; mmPerHour: number | null; trend: RainTrend | null }
  | {
      status: "approaching";
      etaMinutes: number;
      source: "forecast" | "trend";
      mmPerHour: number | null;
      // Fase de intensificación opcional: cuando primero llega un borde de
      // lluvia flojo y, más tarde, un núcleo intenso notablemente más fuerte.
      // El aviso principal (etaMinutes/mmPerHour) describe el borde, e
      // "intensification" el núcleo que llega después.
      intensification: { etaMinutes: number; mmPerHour: number } | null;
    }
  | { status: "clear" }
  // Se está analizando la ubicación (aún no hay veredicto): se muestra
  // mientras se descargan y procesan los frames, para no enseñar el mensaje
  // de la ubicación anterior mientras tanto.
  | { status: "analyzing" }
  | { status: "unknown" };

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// Proyección Web Mercator estándar (la misma que usan Leaflet/Google/Bing):
// convierte lat/lon al píxel global que le correspondería en un mundo de
// 256*2^zoom píxeles de lado.
export function latLonToGlobalPixel(lat: number, lon: number, zoom: number) {
  const scale = TILE_SIZE * Math.pow(2, zoom);
  const x = ((lon + 180) / 360) * scale;
  const latRad = (lat * Math.PI) / 180;
  const y =
    (0.5 - Math.log(Math.tan(Math.PI / 4 + latRad / 2)) / (2 * Math.PI)) * scale;
  return { x, y };
}

// Análisis vacío (sin lluvia) para cuando no se puede montar el mosaico.
function emptyFrameAnalysis(time: number, isForecast: boolean): FrameRainAnalysis {
  return {
    time,
    isForecast,
    rainingAtLocation: false,
    intensityAtLocationMmPerHour: null,
    nearestRainKm: null,
    nearestRainIntensityMmPerHour: null,
    nearestIntenseKm: null,
    nearestIntenseIntensityMmPerHour: null,
    nearestHeavierKm: null,
    nearestLighterKm: null,
    grid: new Float32Array(0),
    gridW: 0,
    userGridX: 0,
    userGridY: 0,
  };
}

// Monta el mosaico de teselas de radar en un canvas y devuelve sus píxeles RGBA.
// SOLO NAVEGADOR (usa canvas/Image). El comprobador de la nube construye el
// mismo array RGBA por su cuenta (decodificando los PNG) y llama directamente a
// analyzeMosaicPixels, para reutilizar exactamente el mismo análisis.
async function loadMosaicPixels(
  host: string,
  frame: RadarFrame,
  centerTile: { x: number; y: number },
  mosaicSize: number
): Promise<Uint8ClampedArray | null> {
  const canvas = document.createElement("canvas");
  canvas.width = mosaicSize;
  canvas.height = mosaicSize;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  const loads: Promise<void>[] = [];
  for (let dx = -TILE_RADIUS; dx <= TILE_RADIUS; dx++) {
    for (let dy = -TILE_RADIUS; dy <= TILE_RADIUS; dy++) {
      const url = buildTileUrlForCoord(
        host,
        frame,
        ANALYSIS_ZOOM,
        centerTile.x + dx,
        centerTile.y + dy
      );
      loads.push(
        loadImage(url).then((img) => {
          if (img) {
            ctx.drawImage(img, (dx + TILE_RADIUS) * TILE_SIZE, (dy + TILE_RADIUS) * TILE_SIZE);
          }
        })
      );
    }
  }
  await Promise.all(loads);
  return ctx.getImageData(0, 0, mosaicSize, mosaicSize).data;
}

async function analyzeFrame(
  host: string,
  frame: RadarFrame,
  centerTile: { x: number; y: number },
  userPxInMosaic: { x: number; y: number },
  kmPerPixel: number,
  isForecast: boolean
): Promise<FrameRainAnalysis> {
  const mosaicSize = (TILE_RADIUS * 2 + 1) * TILE_SIZE;
  const data = await loadMosaicPixels(host, frame, centerTile, mosaicSize);
  if (!data) return emptyFrameAnalysis(frame.time, isForecast);
  return analyzeMosaicPixels(data, mosaicSize, userPxInMosaic, kmPerPixel, isForecast, frame.time);
}

// Análisis puro de un mosaico RGBA ya montado (sin nada de navegador): lo usan
// tanto la app (canvas) como el comprobador de la nube (PNG decodificado). El
// array `data` es RGBA continuo de mosaicSize x mosaicSize píxeles.
export function analyzeMosaicPixels(
  data: Uint8ClampedArray | Uint8Array,
  mosaicSize: number,
  userPxInMosaic: { x: number; y: number },
  kmPerPixel: number,
  isForecast: boolean,
  time: number
): FrameRainAnalysis {
  const pixelAt = (px: number, py: number) => {
    if (px < 0 || py < 0 || px >= mosaicSize || py >= mosaicSize) {
      return { r: 0, g: 0, b: 0, a: 0 };
    }
    const i = (Math.floor(py) * mosaicSize + Math.floor(px)) * 4;
    return { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] };
  };

  const userPixel = pixelAt(Math.round(userPxInMosaic.x), Math.round(userPxInMosaic.y));
  const userDbz =
    userPixel.a > RAIN_ALPHA_THRESHOLD ? rgbToDbz(userPixel.r, userPixel.g, userPixel.b) : null;
  const userIntensity = userDbz !== null ? dbzToMmPerHour(userDbz) : null;
  // "Lloviendo de verdad" exige superar el umbral de intensidad mínima, no
  // solo tener algún color de radar (que incluye trazas casi imperceptibles).
  const rainingAtLocation = userIntensity !== null && userIntensity >= MEANINGFUL_RAIN_MM_PER_HOUR;
  const intensityAtLocationMmPerHour = rainingAtLocation ? userIntensity : null;
  const currentDbz = rainingAtLocation ? userDbz : null;

  let nearestPxDist = Infinity;
  let nearestPixelDbz: number | null = null;
  let nearestIntensePxDist = Infinity;
  let nearestIntensePixelDbz: number | null = null;
  // Solo tienen sentido si ya llueve en la ubicación (currentDbz !== null):
  // ¿hay, cerca, un punto notablemente más intenso (núcleo acercándose) o
  // más flojo/sin lluvia (borde de la tormenta acercándose)?
  let nearestHeavierPxDist = Infinity;
  let nearestLighterPxDist = Infinity;

  // Rejilla de intensidad submuestreada (paso SAMPLE_STEP) para el vector de
  // movimiento del campo.
  const gridW = Math.ceil(mosaicSize / SAMPLE_STEP);
  const grid = new Float32Array(gridW * gridW);

  for (let py = 0; py < mosaicSize; py += SAMPLE_STEP) {
    for (let px = 0; px < mosaicSize; px += SAMPLE_STEP) {
      const pixel = pixelAt(px, py);
      const hasColor = pixel.a > RAIN_ALPHA_THRESHOLD;
      const pxDbz = hasColor ? rgbToDbz(pixel.r, pixel.g, pixel.b) : null;
      const pxIntensity = pxDbz !== null ? dbzToMmPerHour(pxDbz) : null;
      const isMeaningfulRain = pxIntensity !== null && pxIntensity >= MEANINGFUL_RAIN_MM_PER_HOUR;
      const d = Math.hypot(px - userPxInMosaic.x, py - userPxInMosaic.y);

      if (isMeaningfulRain) {
        grid[(py / SAMPLE_STEP) * gridW + px / SAMPLE_STEP] = pxIntensity;
      }
      if (isMeaningfulRain) {
        if (d < nearestPxDist) {
          nearestPxDist = d;
          nearestPixelDbz = pxDbz;
        }
        if (pxIntensity >= INTENSE_RAIN_MM_PER_HOUR && d < nearestIntensePxDist) {
          nearestIntensePxDist = d;
          nearestIntensePixelDbz = pxDbz;
        }
        if (currentDbz !== null && pxDbz !== null) {
          if (pxDbz >= currentDbz + HEAVIER_DBZ_MARGIN && d < nearestHeavierPxDist) {
            nearestHeavierPxDist = d;
          }
          if (pxDbz <= currentDbz - LIGHTER_DBZ_MARGIN && d < nearestLighterPxDist) {
            nearestLighterPxDist = d;
          }
        }
      } else if (currentDbz !== null && d < nearestLighterPxDist) {
        // Sin lluvia significativa cerca también cuenta como "más flojo": es
        // el borde por el que la tormenta podría estar dejando de cubrir el
        // punto (incluye trazas por debajo del umbral, no solo transparente).
        nearestLighterPxDist = d;
      }
    }
  }

  return {
    time,
    isForecast,
    rainingAtLocation,
    intensityAtLocationMmPerHour,
    nearestRainKm: Number.isFinite(nearestPxDist) ? nearestPxDist * kmPerPixel : null,
    nearestRainIntensityMmPerHour: nearestPixelDbz !== null ? dbzToMmPerHour(nearestPixelDbz) : null,
    nearestIntenseKm: Number.isFinite(nearestIntensePxDist) ? nearestIntensePxDist * kmPerPixel : null,
    nearestIntenseIntensityMmPerHour:
      nearestIntensePixelDbz !== null ? dbzToMmPerHour(nearestIntensePixelDbz) : null,
    nearestHeavierKm: Number.isFinite(nearestHeavierPxDist) ? nearestHeavierPxDist * kmPerPixel : null,
    nearestLighterKm: Number.isFinite(nearestLighterPxDist) ? nearestLighterPxDist * kmPerPixel : null,
    grid,
    gridW,
    userGridX: userPxInMosaic.x / SAMPLE_STEP,
    userGridY: userPxInMosaic.y / SAMPLE_STEP,
  };
}

// Estima el desplazamiento (dx, dy) en celdas que mejor alinea el campo de
// lluvia del frame A con el del frame B (o sea, cuánto se ha movido el campo
// de A a B). Correlación cruzada simple: para cada desplazamiento candidato,
// suma el solape de intensidad; se queda con el de mayor solape. Devuelve
// null si no hay lluvia suficiente para fiarse.
function estimateFieldMotion(
  a: Float32Array,
  b: Float32Array,
  gridW: number,
  maxShift: number
): { dx: number; dy: number; overlap: number } | null {
  // Celdas con lluvia en A (submuestreadas si son muchas, para acotar coste).
  const xs: number[] = [];
  const ys: number[] = [];
  const vs: number[] = [];
  for (let gy = 0; gy < gridW; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      const v = a[gy * gridW + gx];
      if (v > 0) {
        xs.push(gx);
        ys.push(gy);
        vs.push(v);
      }
    }
  }
  if (xs.length < MIN_MOTION_OVERLAP_CELLS) return null;
  const stride = xs.length > 4000 ? Math.ceil(xs.length / 4000) : 1;

  let best: { dx: number; dy: number; overlap: number } | null = null;
  let bestScore = -1;
  for (let dy = -maxShift; dy <= maxShift; dy++) {
    for (let dx = -maxShift; dx <= maxShift; dx++) {
      let score = 0;
      let overlap = 0;
      for (let i = 0; i < xs.length; i += stride) {
        const bx = xs[i] + dx;
        const by = ys[i] + dy;
        if (bx >= 0 && bx < gridW && by >= 0 && by < gridW) {
          const vb = b[by * gridW + bx];
          if (vb > 0) {
            score += Math.min(vs[i], vb);
            overlap++;
          }
        }
      }
      if (overlap > 0 && score > bestScore) {
        bestScore = score;
        best = { dx, dy, overlap: overlap * stride };
      }
    }
  }
  if (!best || best.overlap < MIN_MOTION_OVERLAP_CELLS) return null;
  return best;
}

// Proyecta el campo de lluvia actual según el vector de movimiento (celdas por
// minuto) y determina si alguna lluvia alcanzará al punto del usuario en los
// próximos maxEtaMin minutos. Para cada celda con lluvia, se descompone su
// desplazamiento hasta el punto en la componente a lo largo del movimiento
// (río arriba = viene hacia el punto) y la perpendicular (si es mayor que el
// corredor, pasa de largo). El tiempo de llegada es distancia_a_lo_largo /
// velocidad. Devuelve el inicio (primera lluvia en llegar) y el pico de
// intensidad de entre todo lo que va a pasar por encima.
function projectApproach(
  grid: Float32Array,
  gridW: number,
  userX: number,
  userY: number,
  vxPerMin: number,
  vyPerMin: number,
  kmPerCell: number,
  maxEtaMin: number
): { onsetEta: number; onsetMm: number; peakMm: number; peakEta: number } | null {
  const speed = Math.hypot(vxPerMin, vyPerMin); // celdas/min
  if (speed === 0) return null;
  const dirX = vxPerMin / speed;
  const dirY = vyPerMin / speed;
  const halfCells = APPROACH_CORRIDOR_HALF_KM / kmPerCell;

  let onsetEta: number | null = null;
  let onsetMm = 0;
  // Todas las celdas que van a pasar por encima, para poder exigir un área
  // mínima al núcleo en vez de fiarnos de la celda más fuerte (que puede ser
  // un punto aislado sin apenas relevancia).
  const incoming: { mm: number; t: number }[] = [];
  for (let gy = 0; gy < gridW; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      const v = grid[gy * gridW + gx];
      if (v < MEANINGFUL_RAIN_MM_PER_HOUR) continue;
      const dux = userX - gx;
      const duy = userY - gy;
      const along = dux * dirX + duy * dirY; // >0: la celda está río arriba
      if (along <= 0) continue;
      const perp = Math.abs(dux * dirY - duy * dirX);
      if (perp > halfCells) continue;
      const t = along / speed; // minutos hasta pasar por el punto
      if (t < 1 || t > maxEtaMin) continue;
      if (onsetEta === null || t < onsetEta) {
        onsetEta = t;
        onsetMm = v;
      }
      incoming.push({ mm: v, t });
    }
  }
  if (onsetEta === null || incoming.length === 0) return null;

  // El "pico" no es la celda más intensa, sino la intensidad que alcanza un
  // núcleo con área suficiente: se ordena de más a menos intenso y se toma la
  // que hace el número MIN_CORE_CELLS. Así, un puntito aislado muy intenso no
  // define el aviso; hace falta una mancha de tamaño real.
  incoming.sort((a, b) => b.mm - a.mm);
  const coreIndex = Math.min(MIN_CORE_CELLS - 1, incoming.length - 1);
  const core = incoming[coreIndex];

  return {
    onsetEta: Math.round(onsetEta),
    onsetMm,
    peakMm: core.mm,
    peakEta: Math.round(core.t),
  };
}

// Analiza los últimos frames pasados y de previsión alrededor de una
// ubicación para estimar si hay lluvia acercándose. Devuelve un resultado
// simple que la interfaz puede convertir directamente en un aviso.
export async function detectRainApproach(
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

  // Resolución del suelo en Web Mercator: metros/píxel según zoom y latitud.
  const metersPerPixel =
    (156543.03392 * Math.cos((location.lat * Math.PI) / 180)) / Math.pow(2, ANALYSIS_ZOOM);
  const kmPerPixel = metersPerPixel / 1000;

  const recentPast = pastFrames.slice(-PAST_FRAMES_TO_ANALYZE);
  const results: FrameRainAnalysis[] = [];
  for (const frame of recentPast) {
    results.push(
      await analyzeFrame(host, frame, centerTile, userPxInMosaic, kmPerPixel, false)
    );
    await new Promise((resolve) => setTimeout(resolve, FRAME_ANALYSIS_DELAY_MS));
  }

  // La previsión de RainViewer (si la hay) se analiza siempre: hace falta
  // tanto para saber si se acerca lluvia como, si ya está cayendo, para
  // estimar cómo va a evolucionar (aumentar, remitir, mantenerse...).
  const forecastResults: FrameRainAnalysis[] = [];
  for (const frame of nowcastFrames.slice(0, FORECAST_FRAMES_TO_ANALYZE)) {
    forecastResults.push(
      await analyzeFrame(host, frame, centerTile, userPxInMosaic, kmPerPixel, true)
    );
    await new Promise((resolve) => setTimeout(resolve, FRAME_ANALYSIS_DELAY_MS));
  }

  return evaluateRainApproach(results, forecastResults, kmPerPixel);
}

// Decide el aviso a partir de los análisis por frame ya calculados. Es la parte
// PURA (sin nada de navegador) y por eso la comparten la app y el comprobador de
// la nube: cada uno monta los FrameRainAnalysis a su manera (canvas vs PNG) y
// luego llama aquí para obtener exactamente el mismo veredicto.
export function evaluateRainApproach(
  results: FrameRainAnalysis[],
  forecastResults: FrameRainAnalysis[],
  kmPerPixel: number
): RainApproachResult {
  const latest = results.at(-1);
  if (!latest) return { status: "unknown" };

  if (latest.rainingAtLocation) {
    // Cómo va a evolucionar la lluvia que ya cae: se prioriza la previsión
    // real de RainViewer (si la hay), luego la proyección por vector de
    // movimiento (qué intensidad irá pasando por el punto), y como último
    // recurso la tendencia por movimiento del punto más cercano. Se informa
    // siempre (aumenta / pasa / remite / se mantiene), a cualquier intensidad.
    const trend =
      estimateRainTrend(latest, forecastResults) ??
      estimateRainTrendByMotion(latest, results, kmPerPixel) ??
      estimatePastTrend(latest, results);
    return {
      status: "raining",
      time: latest.time,
      mmPerHour: latest.intensityAtLocationMmPerHour,
      trend,
    };
  }

  // Señal directa: la propia previsión de RainViewer marca lluvia en el punto.
  const forecastHit = forecastResults.find((f) => f.rainingAtLocation);
  if (forecastHit) {
    const etaMinutes = Math.max(1, Math.round((forecastHit.time - latest.time) / 60));
    if (etaMinutes <= MAX_ETA_MINUTES) {
      return {
        status: "approaching",
        etaMinutes,
        source: "forecast",
        // La propia previsión de RainViewer ya predice esta intensidad
        // EN el punto exacto de la ubicación: no hace falta comprobar que
        // "se acerca", el modelo ya lo sitúa ahí.
        mmPerHour: forecastHit.intensityAtLocationMmPerHour,
        intensification: null,
      };
    }
  }

  // Sin previsión útil, se detecta el acercamiento por el VECTOR DE MOVIMIENTO
  // del campo de lluvia: se estima hacia dónde y a qué velocidad se mueve la
  // lluvia (correlando frames consecutivos) y se proyecta si ese movimiento la
  // traerá sobre el punto. A diferencia de seguir el "punto más cercano" (que
  // salta entre celdas e ignora la dirección), esto solo avisa de la lluvia
  // que realmente se dirige hacia la ubicación.
  const approach = estimateApproachByMotion(results, kmPerPixel);
  if (approach) return approach;

  return { status: "clear" };
}

// Estima el vector de movimiento medio del campo de lluvia (celdas/min),
// promediando la correlación de cada par de frames consecutivos ponderada por
// su solape de lluvia. Devuelve null solo si no hay lluvia suficiente para
// estimarlo. No aplica umbrales de velocidad (eso lo decide quien lo use).
function estimateFieldMotionVector(
  results: FrameRainAnalysis[],
  kmPerPixel: number
): { vxPerMin: number; vyPerMin: number; kmPerCell: number; gridW: number } | null {
  const latest = results.at(-1);
  if (!latest || latest.gridW === 0) return null;
  const gridW = latest.gridW;
  const kmPerCell = kmPerPixel * SAMPLE_STEP;
  const intervalMin =
    results.length >= 2 ? (results[results.length - 1].time - results[0].time) / 60 / (results.length - 1) : 10;
  const maxShift = Math.ceil((MOTION_SEARCH_MAX_KMH * (intervalMin / 60)) / kmPerCell) + 1;

  let sumW = 0;
  let sumVx = 0;
  let sumVy = 0;
  for (let i = 0; i < results.length - 1; i++) {
    if (results[i].gridW !== gridW || results[i + 1].gridW !== gridW) continue;
    const iv = (results[i + 1].time - results[i].time) / 60;
    if (iv <= 0) continue;
    const mv = estimateFieldMotion(results[i].grid, results[i + 1].grid, gridW, maxShift);
    if (!mv) continue;
    const w = mv.overlap;
    sumVx += (mv.dx / iv) * w;
    sumVy += (mv.dy / iv) * w;
    sumW += w;
  }
  if (sumW === 0) return null;
  return { vxPerMin: sumVx / sumW, vyPerMin: sumVy / sumW, kmPerCell, gridW };
}

// Detección de acercamiento por vector de movimiento (ver comentario en
// detectRainApproach). Devuelve un aviso "approaching" o null si no se detecta
// lluvia dirigiéndose al punto en el horizonte.
function estimateApproachByMotion(
  results: FrameRainAnalysis[],
  kmPerPixel: number
): RainApproachResult | null {
  const mv = estimateFieldMotionVector(results, kmPerPixel);
  const latest = results.at(-1);
  if (!mv || !latest) return null;

  const speedKmh = Math.hypot(mv.vxPerMin, mv.vyPerMin) * mv.kmPerCell * 60;
  // Campo prácticamente estacionario: no hay un acercamiento que proyectar.
  // (No se pone tope superior: si el frente va rápido, mejor avisarlo.)
  if (speedKmh < MIN_MOTION_SPEED_KMH) return null;

  const proj = projectApproach(
    latest.grid,
    mv.gridW,
    latest.userGridX,
    latest.userGridY,
    mv.vxPerMin,
    mv.vyPerMin,
    mv.kmPerCell,
    MAX_ETA_MINUTES
  );
  if (!proj) return null;

  // El titular es la intensidad más fuerte que va a pasar (el pico); si ese
  // pico llega más tarde y SUBE DE CATEGORÍA respecto al inicio, se comunica
  // como fase de intensificación. Exigir el salto de categoría (y no solo una
  // diferencia numérica) evita anunciar como "intensificación" un cambio que
  // en la práctica es la misma clase de lluvia.
  let intensification: { etaMinutes: number; mmPerHour: number } | null = null;
  if (proj.peakEta > proj.onsetEta && intensityRank(proj.peakMm) > intensityRank(proj.onsetMm)) {
    intensification = { etaMinutes: proj.peakEta, mmPerHour: proj.peakMm };
  }
  return {
    status: "approaching",
    etaMinutes: Math.max(1, proj.onsetEta),
    source: "trend",
    mmPerHour: proj.onsetMm,
    intensification,
  };
}

// Tendencia mientras ya llueve, usando el vector de movimiento: proyecta qué
// intensidad irá pasando por el punto en los próximos minutos (la lluvia que
// estará sobre el punto en el minuto t es la que ahora está en punto − v·t) y
// la compara con la intensidad actual. Responde directamente a "¿va a aumentar
// o no?": si va a intensificarse, cuándo; si el frente va a pasar (deja de
// llover), cuándo; si va a remitir; o si se mantiene parecida.
function estimateRainTrendByMotion(
  latest: FrameRainAnalysis,
  results: FrameRainAnalysis[],
  kmPerPixel: number
): RainTrend | null {
  const current = latest.intensityAtLocationMmPerHour;
  if (current === null || current <= 0) return null;
  const mv = estimateFieldMotionVector(results, kmPerPixel);
  if (!mv) return null;
  const { vxPerMin, vyPerMin, gridW } = mv;
  const grid = latest.grid;
  const ux = latest.userGridX;
  const uy = latest.userGridY;

  const sample = (x: number, y: number) => {
    let best = 0;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const xx = Math.round(x + ox);
        const yy = Math.round(y + oy);
        if (xx >= 0 && xx < gridW && yy >= 0 && yy < gridW) {
          best = Math.max(best, grid[yy * gridW + xx]);
        }
      }
    }
    return best;
  };

  // Serie de intensidades que pasarán por el punto en el próximo horizonte.
  // El aumento debe SOSTENERSE varios minutos seguidos: una celda diminuta
  // cruzando por encima da uno o dos minutos de lluvia más fuerte y no es una
  // intensificación real (mismo problema del "puntito amarillo", pero visto
  // en el tiempo en vez de en el área).
  let increaseEta: number | null = null;
  let increaseMm: number | null = null;
  let runStart: number | null = null;
  let runPeak = 0;
  let lastMeaningfulT = 0;
  let tailSum = 0;
  let tailN = 0;
  for (let t = 1; t <= MAX_ETA_MINUTES; t++) {
    const v = sample(ux - vxPerMin * t, uy - vyPerMin * t);
    if (v >= MEANINGFUL_RAIN_MM_PER_HOUR) lastMeaningfulT = t;

    if (v >= current * INTENSITY_INCREASE_RATIO) {
      if (runStart === null) {
        runStart = t;
        runPeak = v;
      } else if (v > runPeak) {
        runPeak = v;
      }
      if (increaseEta === null && t - runStart + 1 >= MIN_SUSTAINED_INCREASE_MIN) {
        increaseEta = runStart;
        increaseMm = runPeak;
      }
    } else {
      runStart = null;
      runPeak = 0;
    }

    if (t > MAX_ETA_MINUTES - 6) {
      tailSum += v;
      tailN++;
    }
  }
  const tailMm = tailN > 0 ? tailSum / tailN : current;

  // Prioridad: primero si va a AUMENTAR (que es lo que se pregunta), luego si
  // el frente va a pasar (deja de llover dentro del horizonte), luego si
  // remite, y si nada de eso, se mantiene parecida.
  if (increaseEta !== null) {
    return { kind: "increasing", etaMinutes: increaseEta, mmPerHour: increaseMm, source: "trend" };
  }
  if (lastMeaningfulT < MAX_ETA_MINUTES) {
    return { kind: "ending", etaMinutes: Math.max(1, lastMeaningfulT), source: "trend" };
  }
  if (tailMm <= current * INTENSITY_DECREASE_RATIO) {
    return { kind: "decreasing", etaMinutes: null, source: "trend" };
  }
  return { kind: "steady", forMinutes: MAX_ETA_MINUTES, source: "trend" };
}

// Calidad mínima del ajuste lineal (R²) para fiarnos de la extrapolación:
// por debajo de esto los puntos están demasiado dispersos (la distancia va
// dando bandazos en vez de reducirse de forma consistente) y dar un ETA sería
// inventar. Con solo 2 puntos el ajuste es perfecto por definición (R²=1), así
// que este filtro solo actúa cuando hay 3 o más frames.
const MIN_APPROACH_FIT_R2 = 0.5;

// Dado un histórico (tiempo, distancia en km) al punto que interesa, estima
// los minutos hasta que la distancia llegue a 0 (la lluvia alcanza el punto)
// mediante una regresión lineal por mínimos cuadrados sobre TODOS los frames,
// no solo el primero y el último: como el píxel de lluvia más cercano puede
// saltar de una celda a otra entre frames, un ajuste de dos puntos es muy
// sensible al ruido; la regresión sobre todos los puntos suaviza eso y da una
// velocidad de acercamiento más estable. Devuelve null si hay menos de dos
// puntos, si no se acerca de forma consistente (pendiente no negativa, poco
// acercamiento total o ajuste pobre) o si el ETA se sale del horizonte.
function extrapolateApproach(points: { time: number; km: number }[]): number | null {
  if (points.length < 2) return null;
  const n = points.length;
  const first = points[0];
  const last = points[n - 1];

  // Tiempo en minutos relativos al primer frame, para evitar números enormes.
  const t0 = first.time;
  const xs = points.map((p) => (p.time - t0) / 60);
  const ys = points.map((p) => p.km);
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - meanX) * (ys[i] - meanY);
    sxx += (xs[i] - meanX) ** 2;
  }
  if (sxx === 0) return null;

  const slopeKmPerMin = sxy / sxx; // negativo si la distancia se reduce (se acerca)
  const totalDropKm = first.km - last.km;
  if (slopeKmPerMin >= 0 || totalDropKm <= MIN_APPROACH_KM) return null;

  // Calidad del ajuste (R²): que la reducción sea consistente, no un vaivén.
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const predicted = meanY + slopeKmPerMin * (xs[i] - meanX);
    ssRes += (ys[i] - predicted) ** 2;
    ssTot += (ys[i] - meanY) ** 2;
  }
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  if (r2 < MIN_APPROACH_FIT_R2) return null;

  // Momento (min desde el primer frame) en que la recta ajustada cruza km=0,
  // medido desde el último frame (≈ ahora).
  const minutesToZeroFromStart = meanX - meanY / slopeKmPerMin;
  const etaMinutes = Math.round(minutesToZeroFromStart - xs[n - 1]);
  return etaMinutes > 0 && etaMinutes <= MAX_ETA_MINUTES ? etaMinutes : null;
}

// Cuando ya llueve y no hay previsión útil de RainViewer, se estima la
// tendencia con la misma idea que "approaching" pero mirando si hay, cerca,
// un punto notablemente más intenso o más flojo/sin lluvia cuya distancia se
// ha ido reduciendo en los últimos frames pasados (el núcleo de la tormenta,
// o su borde, acercándose).
function estimatePastTrend(
  latest: FrameRainAnalysis,
  results: FrameRainAnalysis[]
): RainTrend | null {
  const withHeavier = results.filter(
    (r): r is FrameRainAnalysis & { nearestHeavierKm: number } => r.nearestHeavierKm !== null
  );
  const heavierEta = extrapolateApproach(withHeavier.map((r) => ({ time: r.time, km: r.nearestHeavierKm })));
  if (heavierEta !== null) {
    return { kind: "increasing", etaMinutes: heavierEta, source: "trend" };
  }

  const withLighter = results.filter(
    (r): r is FrameRainAnalysis & { nearestLighterKm: number } => r.nearestLighterKm !== null
  );
  const lighterEta = extrapolateApproach(withLighter.map((r) => ({ time: r.time, km: r.nearestLighterKm })));
  if (lighterEta !== null) {
    return { kind: "decreasing", etaMinutes: lighterEta, source: "trend" };
  }

  // Sin señal de acercamiento clara en ninguno de los dos: al menos se
  // informa de si la intensidad exacta en el punto ha subido o bajado en los
  // últimos frames pasados, aunque no se pueda dar un ETA para ello. Se mira
  // en ambos sentidos (antes solo se detectaba la bajada): si la lluvia sobre
  // el punto viene intensificándose, "es probable que aumente"; si viene
  // remitiendo, "es probable que disminuya".
  const withIntensity = results.filter(
    (r): r is FrameRainAnalysis & { intensityAtLocationMmPerHour: number } =>
      r.intensityAtLocationMmPerHour !== null
  );
  if (withIntensity.length >= 2 && latest.intensityAtLocationMmPerHour !== null) {
    const first = withIntensity[0].intensityAtLocationMmPerHour;
    const ratio = latest.intensityAtLocationMmPerHour / first;
    if (ratio > INTENSITY_INCREASE_RATIO) {
      return { kind: "increasing", etaMinutes: null, source: "trend" };
    }
    if (ratio < INTENSITY_DECREASE_RATIO) {
      return { kind: "decreasing", etaMinutes: null, source: "trend" };
    }
  }

  return null;
}

// A partir de los frames de previsión (si los hay), estima cómo va a
// evolucionar la lluvia que ya está cayendo en el punto: si el frente va a
// pasar (dejará de llover), si aumentará, si se mantendrá o si está
// remitiendo. Sin previsión disponible no se aventura nada, porque
// RainViewer no siempre da frames de nowcast.
function estimateRainTrend(
  latest: FrameRainAnalysis,
  forecastResults: FrameRainAnalysis[]
): RainTrend | null {
  if (forecastResults.length === 0) return null;

  const endingFrame = forecastResults.find((f) => !f.rainingAtLocation);
  if (endingFrame) {
    const etaMinutes = Math.max(1, Math.round((endingFrame.time - latest.time) / 60));
    if (etaMinutes > MAX_ETA_MINUTES) return null;
    return { kind: "ending", etaMinutes, source: "forecast" };
  }

  const lastForecast = forecastResults[forecastResults.length - 1];
  const currentIntensity = latest.intensityAtLocationMmPerHour;
  const futureIntensity = lastForecast.intensityAtLocationMmPerHour;
  if (currentIntensity === null || futureIntensity === null || currentIntensity <= 0) {
    return null;
  }

  const minutesAhead = Math.max(1, Math.round((lastForecast.time - latest.time) / 60));
  if (minutesAhead > MAX_ETA_MINUTES) return null;
  const ratio = futureIntensity / currentIntensity;

  if (ratio > INTENSITY_INCREASE_RATIO) {
    return { kind: "increasing", etaMinutes: minutesAhead, source: "forecast" };
  }
  if (ratio < INTENSITY_DECREASE_RATIO) {
    return { kind: "decreasing", etaMinutes: null, source: "forecast" };
  }
  return { kind: "steady", forMinutes: minutesAhead, source: "forecast" };
}
