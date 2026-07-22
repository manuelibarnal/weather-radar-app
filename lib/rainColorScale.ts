// Tabla de color de RainViewer para el esquema que realmente sirve
// color=4 (el que usa esta app). La tabla pública de RainViewer
// (https://www.rainviewer.com/api/color-schemes.html) no dice qué número de
// "color" corresponde a qué nombre de paleta, así que en vez de asumirlo se
// comprobó descargando una tesela real y comparando sus píxeles contra las 9
// paletas publicadas: color=4 coincide exactamente con "Universal Blue".
//
// Cada entrada es un punto de control (dBZ, color) en el que cambia el color;
// para nuestro propósito (estimar la intensidad aproximada a partir de un
// píxel) basta con buscar el punto de control más parecido en color.
//
// Por debajo de dBZ 15, "Universal Blue" usa una gama de grises/marrones
// distinta (precipitación traza/muy débil) en vez de continuar la escala
// azul-roja. Sin estas entradas, cualquier píxel con lluvia muy débil no
// coincidía con nada de la tabla y se descartaba como intensidad "null" —
// eso hacía que, con lluvia floja, ni la intensidad ni la tendencia
// aparecieran casi nunca. Se guardan aparte (TRACE) porque no tiene sentido
// mostrarlas en la leyenda (son cantidades casi inapreciables).
const TRACE_COLOR_TABLE: { dbz: number; hex: string }[] = [
  { dbz: -10, hex: "#636159" },
  { dbz: -9, hex: "#66635a" },
  { dbz: -8, hex: "#69665c" },
  { dbz: -7, hex: "#6c685d" },
  { dbz: -6, hex: "#6f6b5f" },
  { dbz: -5, hex: "#726e61" },
  { dbz: -4, hex: "#757062" },
  { dbz: -3, hex: "#787364" },
  { dbz: -2, hex: "#7c7565" },
  { dbz: -1, hex: "#7f7867" },
  { dbz: 0, hex: "#827b69" },
  { dbz: 1, hex: "#857d6a" },
  { dbz: 2, hex: "#88806c" },
  { dbz: 3, hex: "#8b826d" },
  { dbz: 4, hex: "#8e856f" },
  { dbz: 5, hex: "#928871" },
  { dbz: 6, hex: "#9e9375" },
  { dbz: 7, hex: "#aa9e79" },
  { dbz: 8, hex: "#b6a97e" },
  { dbz: 9, hex: "#c2b482" },
  { dbz: 10, hex: "#cec087" },
  { dbz: 11, hex: "#d2c48b" },
  { dbz: 12, hex: "#d6c88f" },
  { dbz: 13, hex: "#dacc93" },
  { dbz: 14, hex: "#ded097" },
];

const RAIN_COLOR_TABLE: { dbz: number; hex: string }[] = [
  { dbz: 15, hex: "#88ddee" },
  { dbz: 16, hex: "#6cd1eb" },
  { dbz: 17, hex: "#51c5e8" },
  { dbz: 18, hex: "#36bae5" },
  { dbz: 19, hex: "#1baee2" },
  { dbz: 20, hex: "#00a3e0" },
  { dbz: 21, hex: "#009ad5" },
  { dbz: 22, hex: "#0091ca" },
  { dbz: 23, hex: "#0088bf" },
  { dbz: 24, hex: "#007fb4" },
  { dbz: 25, hex: "#0077aa" },
  { dbz: 26, hex: "#0070a3" },
  { dbz: 27, hex: "#00699c" },
  { dbz: 28, hex: "#006295" },
  { dbz: 29, hex: "#005b8e" },
  { dbz: 30, hex: "#005588" },
  { dbz: 31, hex: "#005180" },
  { dbz: 32, hex: "#004e78" },
  { dbz: 33, hex: "#004a70" },
  { dbz: 34, hex: "#004768" },
  { dbz: 35, hex: "#ffee00" },
  { dbz: 36, hex: "#ffe000" },
  { dbz: 37, hex: "#ffd200" },
  { dbz: 38, hex: "#ffc500" },
  { dbz: 39, hex: "#ffb700" },
  { dbz: 40, hex: "#ffaa00" },
  { dbz: 41, hex: "#ff9f00" },
  { dbz: 42, hex: "#ff9500" },
  { dbz: 43, hex: "#ff8b00" },
  { dbz: 44, hex: "#ff8100" },
  { dbz: 45, hex: "#ff4400" },
  { dbz: 46, hex: "#f23600" },
  { dbz: 47, hex: "#e62800" },
  { dbz: 48, hex: "#d91b00" },
  { dbz: 49, hex: "#cd0d00" },
  { dbz: 50, hex: "#c10000" },
  { dbz: 51, hex: "#a80000" },
  { dbz: 52, hex: "#8f0000" },
  { dbz: 53, hex: "#760000" },
  { dbz: 54, hex: "#5d0000" },
  { dbz: 55, hex: "#ffaaff" },
  { dbz: 56, hex: "#ff9fff" },
  { dbz: 57, hex: "#ff95ff" },
  { dbz: 58, hex: "#ff8bff" },
  { dbz: 59, hex: "#ff81ff" },
  { dbz: 60, hex: "#ff77ff" },
  { dbz: 61, hex: "#ff6cff" },
  { dbz: 62, hex: "#ff62ff" },
  { dbz: 63, hex: "#ff58ff" },
  { dbz: 64, hex: "#ff4eff" },
  { dbz: 65, hex: "#ffffff" },
];

// Tabla completa (traza + principal) para clasificar cualquier píxel que ya
// se sepa que tiene lluvia (alpha por encima del umbral): en ese caso el
// color SIEMPRE viene de esta paleta (posiblemente interpolado por el modo
// "smooth" de RainViewer entre dos puntos de control adyacentes), así que no
// hace falta descartar coincidencias imperfectas como si fueran ruido.
const CLASSIFICATION_TABLE = [...TRACE_COLOR_TABLE, ...RAIN_COLOR_TABLE];

const MIN_RAIN_DBZ = RAIN_COLOR_TABLE[0].dbz;
const MAX_RAIN_DBZ = RAIN_COLOR_TABLE[RAIN_COLOR_TABLE.length - 1].dbz;

export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

// Relación Z-R de Marshall-Palmer (Z = 200 * R^1.6), la aproximación clásica
// y más usada para convertir reflectividad de radar (dBZ) a intensidad de
// lluvia. Es una aproximación general: la relación real varía según el tipo
// de precipitación y no hay calibración específica por zona aquí.
export function dbzToMmPerHour(dbz: number): number {
  const z = Math.pow(10, dbz / 10);
  return Math.pow(z / 200, 1 / 1.6);
}

// Busca en la tabla de color (traza + principal) el punto de control cuyo
// RGB es más parecido al color muestreado, y devuelve su dBZ. Se asume que
// solo se llama con píxeles ya confirmados como lluvia (alpha por encima del
// umbral en quien llama), así que siempre se devuelve la mejor coincidencia
// en vez de descartarla: no hay ningún caso real en esta app en el que se
// pase aquí un color que no sea de la paleta de radar.
export function rgbToDbz(r: number, g: number, b: number): number | null {
  let best: { dbz: number; dist: number } | null = null;
  for (const entry of CLASSIFICATION_TABLE) {
    const [er, eg, eb] = hexToRgb(entry.hex);
    const dist = (er - r) ** 2 + (eg - g) ** 2 + (eb - b) ** 2;
    if (!best || dist < best.dist) best = { dbz: entry.dbz, dist };
  }
  return best?.dbz ?? null;
}

export function rgbToMmPerHour(r: number, g: number, b: number): number | null {
  const dbz = rgbToDbz(r, g, b);
  return dbz === null ? null : dbzToMmPerHour(dbz);
}

// Inversa de dbzToMmPerHour, para poder ir de una intensidad (l/m²/h) al
// color de la escala que le corresponde.
function mmPerHourToDbz(mmPerHour: number): number {
  const z = 200 * Math.pow(Math.max(mmPerHour, 0.001), 1.6);
  return 10 * Math.log10(z);
}

// Color de la escala (rango 15-65 dBZ, el visible en la leyenda) que le
// corresponde a una intensidad dada, para poder colorear un aviso según su
// gravedad real en vez de con un color genérico fijo.
export function mmPerHourToColor(mmPerHour: number): string {
  const dbz = mmPerHourToDbz(mmPerHour);
  const clamped = Math.min(MAX_RAIN_DBZ, Math.max(MIN_RAIN_DBZ, dbz));
  let best = RAIN_COLOR_TABLE[0];
  let bestDist = Infinity;
  for (const entry of RAIN_COLOR_TABLE) {
    const dist = Math.abs(entry.dbz - clamped);
    if (dist < bestDist) {
      bestDist = dist;
      best = entry;
    }
  }
  return best.hex;
}

// Aclara un color hacia blanco una cantidad (0-1), para el parpadeo del
// aviso: el color de la intensidad vira hacia blanco y vuelve, en vez de
// usar un blanco puro que perdería la referencia al color original.
export function lightenTowardWhite(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const lr = Math.round(r + (255 - r) * amount);
  const lg = Math.round(g + (255 - g) * amount);
  const lb = Math.round(b + (255 - b) * amount);
  return `rgb(${lr}, ${lg}, ${lb})`;
}

// Puntos de la leyenda (degradado real de la app) con su intensidad en
// l/m²/h (equivalente exacto a mm/h) para mostrar debajo de la barra.
export const LEGEND_GRADIENT_STOPS = RAIN_COLOR_TABLE.map((entry) => ({
  hex: entry.hex,
  percent: ((entry.dbz - MIN_RAIN_DBZ) / (MAX_RAIN_DBZ - MIN_RAIN_DBZ)) * 100,
}));

export const LEGEND_LABELS = [15, 25, 35, 45, 55, 65].map((dbz) => ({
  percent: ((dbz - MIN_RAIN_DBZ) / (MAX_RAIN_DBZ - MIN_RAIN_DBZ)) * 100,
  mmPerHour: dbzToMmPerHour(dbz),
}));

// Categorías de intensidad con nombres descriptivos que se entienden solos
// ("lluvia moderada" dice mucho más que "intensidad Media") y que evitan
// alarmar de más: 6 l/m²/h es lluvia moderada, no un aguacero. Los umbrales
// siguen la escala meteorológica habitual en l/m²/h (equivalente a mm/h).
// Las etiquetas están pensadas para usarse solas en una frase.
const INTENSITY_LEVELS: { min: number; rank: number; label: string }[] = [
  { min: 60, rank: 5, label: "lluvia torrencial" },
  { min: 30, rank: 4, label: "lluvia muy fuerte" },
  { min: 10, rank: 3, label: "lluvia fuerte" },
  { min: 2, rank: 2, label: "lluvia moderada" },
  { min: 1, rank: 1, label: "lluvia débil" },
  { min: 0, rank: 0, label: "llovizna" },
];

function intensityLevel(mmPerHour: number) {
  return (
    INTENSITY_LEVELS.find((level) => mmPerHour >= level.min) ??
    INTENSITY_LEVELS[INTENSITY_LEVELS.length - 1]
  );
}

// Nombre de la categoría ("lluvia moderada", "llovizna"...).
export function intensityCategory(mmPerHour: number): string {
  return intensityLevel(mmPerHour).label;
}

// Nivel numérico (0 = llovizna … 5 = torrencial), para comparar categorías:
// solo se habla de "intensificación" si sube de categoría de verdad, no por
// una diferencia numérica pequeña dentro del mismo tramo.
export function intensityRank(mmPerHour: number): number {
  return intensityLevel(mmPerHour).rank;
}
