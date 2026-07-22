// Comprobador de la nube: revisa el radar por la zona de cada suscriptor y, si
// hay lluvia (o se acerca), envía un push por OneSignal con el MISMO mensaje que
// la app. Pensado para correr en un cron (GitHub Actions) cada pocos minutos.
//
// Uso:
//   npx tsx checker/index.ts          (real: lista suscriptores y envía)
//   npx tsx checker/index.ts --dry    (no envía; solo dice qué haría)
//
// Variables de entorno:
//   ONESIGNAL_APP_ID        (opcional; por defecto el App ID público de la app)
//   ONESIGNAL_REST_API_KEY  (SECRETA; obligatoria salvo en --dry sin clave)
//   CELL_DECIMALS  agrupación de ubicaciones (1 = ~11 km; por defecto 1)
//   MAX_CELLS      tope de zonas por pasada, para no saturar RainViewer (40)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchRainviewerData } from "../lib/rainviewer";
import { buildAlertBody, buildAlertTitle } from "../lib/alertMessage";
import type { RainApproachResult } from "../lib/rainDetection";
import { detectRainApproachNode } from "./detect";
import { listSubscribers, sendToPlayers, type Subscriber } from "./onesignal";

const APP_ID = process.env.ONESIGNAL_APP_ID ?? "c795e54f-1c18-4eaf-aa8f-a3e5608c3f52";
const API_KEY = process.env.ONESIGNAL_REST_API_KEY ?? "";
const DRY = process.argv.includes("--dry");
const CELL_DECIMALS = Number(process.env.CELL_DECIMALS ?? 1);
const MAX_CELLS = Number(process.env.MAX_CELLS ?? 40);
const CELL_DELAY_MS = 800;

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_PATH = join(__dirname, "state.json");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Redondea la ubicación a una celda, para que suscriptores muy cercanos
// compartan una única comprobación (y así no repetir descargas de teselas).
function cellKey(lat: number, lon: number): string {
  const f = 10 ** CELL_DECIMALS;
  return `${Math.round(lat * f) / f},${Math.round(lon * f) / f}`;
}

// Clave del aviso, para no repetir el mismo push a la misma zona en cada pasada.
// null = no hay aviso (clear/unknown). La ETA de "approaching" se agrupa en
// tramos de 10 min para que solo se reavise si cambia de forma apreciable.
function verdictKey(v: RainApproachResult): string | null {
  if (v.status === "raining") return "raining";
  if (v.status === "approaching") return `approaching-${Math.round(v.etaMinutes / 10) * 10}`;
  return null;
}

type State = Record<string, string>;

function loadState(): State {
  try {
    return existsSync(STATE_PATH) ? (JSON.parse(readFileSync(STATE_PATH, "utf8")) as State) : {};
  } catch {
    return {};
  }
}

async function main() {
  if (!API_KEY && !DRY) {
    console.error("Falta ONESIGNAL_REST_API_KEY (o usa --dry para probar sin enviar).");
    process.exit(1);
  }

  const data = await fetchRainviewerData();
  console.log(`Radar: ${data.past.length} frames de pasado, ${data.nowcast.length} de previsión.`);

  const subs: Subscriber[] = API_KEY ? await listSubscribers(APP_ID, API_KEY) : [];
  console.log(`Suscriptores con ubicación: ${subs.length}`);

  // Agrupar suscriptores por celda (una comprobación por zona).
  const cells = new Map<string, { lat: number; lon: number; ids: string[] }>();
  for (const s of subs) {
    const key = cellKey(s.lat, s.lon);
    const cell = cells.get(key) ?? { lat: s.lat, lon: s.lon, ids: [] };
    cell.ids.push(s.id);
    cells.set(key, cell);
  }
  const cellList = [...cells.entries()].slice(0, MAX_CELLS);
  console.log(`Zonas a revisar: ${cellList.length}${DRY ? " (modo --dry, no se envía)" : ""}`);

  const state = loadState();
  let sent = 0;

  for (const [key, cell] of cellList) {
    const verdict = await detectRainApproachNode(data.host, data.past, data.nowcast, {
      lat: cell.lat,
      lon: cell.lon,
    });
    const vkey = verdictKey(verdict);
    console.log(`  ${key} (${cell.ids.length} disp.): ${verdict.status}${vkey ? ` [${vkey}]` : ""}`);

    if (!vkey) {
      // Sin aviso: se olvida el estado previo para poder reavisar si vuelve.
      delete state[key];
      continue;
    }
    if (vkey === state[key]) continue; // ya avisado y sin cambios

    const title = buildAlertTitle(verdict);
    const body = buildAlertBody(verdict) ?? "";
    if (DRY) {
      console.log(`    [DRY] enviaría a ${cell.ids.length} disp.: "${title}" — ${body}`);
    } else {
      await sendToPlayers(APP_ID, API_KEY, cell.ids, title, body);
      console.log(`    ✓ enviado a ${cell.ids.length} disp.`);
    }
    state[key] = vkey;
    sent++;
    await sleep(CELL_DELAY_MS);
  }

  // El estado se persiste (el workflow lo commitea) para recordar qué se ha
  // avisado ya entre ejecuciones. En --dry no se toca.
  if (!DRY) writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n");
  console.log(`Avisos enviados: ${sent}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
